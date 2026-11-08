import { NextRequest, NextResponse } from 'next/server'
import {
  TOURNAMENT_IDS, getTeamLogoUrl, getTournamentStandings,
  getEnrichedPredictionData,
  type TeamExtendedStats, type H2HStats, type TopScorer
} from '@/lib/sofascore'

export const runtime = 'nodejs'

// ─── Distribución de Poisson ──────────────────────────────────────────────────

function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

function poissonMatrix(homeLam: number, awayLam: number, maxGoals = 9) {
  let homeWin = 0, draw = 0, awayWin = 0
  const scoreProbs: Array<{ home: number; away: number; prob: number }> = []
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonProb(homeLam, h) * poissonProb(awayLam, a)
      if (h > a) homeWin += p
      else if (h === a) draw += p
      else awayWin += p
      scoreProbs.push({ home: h, away: a, prob: p * 100 })
    }
  }
  return {
    homeWin: homeWin * 100, draw: draw * 100, awayWin: awayWin * 100,
    scoreProbs: scoreProbs.sort((a, b) => b.prob - a.prob),
  }
}

function calcOver(homeLam: number, awayLam: number, line: number): number {
  let under = 0
  const lim = Math.ceil(line)
  for (let h = 0; h <= lim; h++) {
    for (let a = 0; a <= lim; a++) {
      if (h + a <= line) under += poissonProb(homeLam, h) * poissonProb(awayLam, a)
    }
  }
  return Math.max(0, Math.min(100, (1 - under) * 100))
}

function calcBtts(homeLam: number, awayLam: number): number {
  return (1 - poissonProb(homeLam, 0)) * (1 - poissonProb(awayLam, 0)) * 100
}

function calcAsianHandicap(homeLam: number, awayLam: number, handicap: number): number {
  let homeCovers = 0
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      const p = poissonProb(homeLam, h) * poissonProb(awayLam, a)
      if (h + handicap > a) homeCovers += p
    }
  }
  return Math.max(0, Math.min(100, homeCovers * 100))
}

// ─── Cálculo de total de goles esperados con distribución ────────────────────

function calcTotalGoalsDistribution(homeLam: number, awayLam: number) {
  const dist: Record<number, number> = {}
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      const total = h + a
      const p = poissonProb(homeLam, h) * poissonProb(awayLam, a)
      dist[total] = (dist[total] || 0) + p
    }
  }
  return dist
}

// ─── Quién anota primero (modelo basado en lambda) ───────────────────────────

function calcFirstGoalScorer(homeLam: number, awayLam: number) {
  const total = homeLam + awayLam
  const homeFirst = total > 0 ? (homeLam / total) * 100 : 50
  const awayFirst = total > 0 ? (awayLam / total) * 100 : 50
  // Prob de empate a cero al final (ninguno marca primero en términos de partido)
  const noGoalMatch = poissonProb(homeLam, 0) * poissonProb(awayLam, 0) * 100
  return {
    homeFirst: parseFloat(homeFirst.toFixed(1)),
    awayFirst: parseFloat(awayFirst.toFixed(1)),
    noGoalGame: parseFloat(noGoalMatch.toFixed(1)),
  }
}

// ─── Predicción de goleador del partido ──────────────────────────────────────

function calcTopScorerOdds(
  topScorers: TopScorer[],
  homeTeamId: number,
  awayTeamId: number,
  homeLam: number,
  awayLam: number
) {
  const homeScorers = topScorers.filter(s => s.teamId === homeTeamId).slice(0, 5)
  const awayScorers = topScorers.filter(s => s.teamId === awayTeamId).slice(0, 5)

  const calcPlayerGoalProb = (scorer: TopScorer, teamLam: number) => {
    const rate = scorer.scoringRate || 0.4
    // Prob de que el jugador marque al menos 1 gol = 1 - Poisson(0, rate * teamLam_adjust)
    const adjustedRate = rate * Math.min(2.0, teamLam / 1.3)
    const prob = (1 - Math.exp(-adjustedRate)) * 100
    return Math.min(65, Math.max(5, prob))
  }

  const homePlayerOdds = homeScorers.map(s => ({
    id: s.id,
    name: s.name,
    team: s.team,
    teamId: s.teamId,
    goalsThisSeason: s.goalsThisSeason,
    scoringRate: s.scoringRate || 0,
    goalProbability: parseFloat(calcPlayerGoalProb(s, homeLam).toFixed(1)),
    logo: s.logo,
  }))

  const awayPlayerOdds = awayScorers.map(s => ({
    id: s.id,
    name: s.name,
    team: s.team,
    teamId: s.teamId,
    goalsThisSeason: s.goalsThisSeason,
    scoringRate: s.scoringRate || 0,
    goalProbability: parseFloat(calcPlayerGoalProb(s, awayLam).toFixed(1)),
    logo: s.logo,
  }))

  return [...homePlayerOdds, ...awayPlayerOdds]
    .sort((a, b) => b.goalProbability - a.goalProbability)
    .slice(0, 8)
}

// ─── Ajuste de lambdas con estadísticas extendidas ───────────────────────────

function adjustLambdaWithExtStats(
  baseLam: number,
  teamExtStats: TeamExtendedStats | undefined,
  oppExtStats: TeamExtendedStats | undefined,
  isHome: boolean
): number {
  if (!teamExtStats) return baseLam

  let lam = baseLam
  const avgGoals = isHome ? teamExtStats.avgGoalsScoredHome : teamExtStats.avgGoalsScoredAway
  const oppConceded = isHome
    ? (oppExtStats?.avgGoalsConcededAway ?? oppExtStats?.avgGoalsConceded ?? 1.2)
    : (oppExtStats?.avgGoalsConcededHome ?? oppExtStats?.avgGoalsConceded ?? 1.2)

  if (avgGoals > 0 && oppConceded > 0) {
    const empiricalLam = (avgGoals + oppConceded) / 2
    lam = lam * 0.55 + empiricalLam * 0.45
  }

  // Ajuste por xG real del equipo
  if (teamExtStats.avgXgFor > 0) {
    lam = lam * 0.6 + teamExtStats.avgXgFor * 0.4
  }

  // Forma reciente: penalizar/premiar por racha
  const formScore = teamExtStats.recentForm.reduce((acc, r) => acc + (r === 'W' ? 1 : r === 'D' ? 0.4 : 0), 0)
  const maxFormScore = teamExtStats.recentForm.length
  if (maxFormScore > 0) {
    const formAdj = 0.9 + (formScore / maxFormScore) * 0.2
    lam *= formAdj
  }

  return Math.max(0.18, Math.min(4.5, lam))
}

// ─── Motor principal de predicción ───────────────────────────────────────────

type StandingsRow = {
  position: number; team_name: string; team_id: number
  played: number; won: number; draw: number; lost: number
  goals_for: number; goals_against: number; points: number
}

function buildPrediction(
  homeTeam: { id: number; name: string; logo: string },
  awayTeam: { id: number; name: string; logo: string },
  standingsData: StandingsRow[],
  enrichedData: {
    homeExtStats?: TeamExtendedStats
    awayExtStats?: TeamExtendedStats
    h2h?: H2HStats
    topScorers?: TopScorer[]
  }
) {
  const totalTeams = standingsData.length || 20
  const leagueAvgGoalsPerMatch = 2.65

  const homeRow = standingsData.find(s => s.team_id === homeTeam.id)
  const awayRow = standingsData.find(s => s.team_id === awayTeam.id)

  function getTeamRates(row: typeof homeRow) {
    if (!row || row.played === 0) {
      return { attack: 1.3, defence: 1.3, position: totalTeams / 2, ppg: 1.2, winRate: 0.33, goalDiff: 0, cleanSheet: 0.25 }
    }
    return {
      attack: row.goals_for / row.played,
      defence: row.goals_against / row.played,
      position: row.position,
      ppg: row.points / row.played,
      winRate: row.won / row.played,
      goalDiff: (row.goals_for - row.goals_against) / row.played,
      cleanSheet: Math.max(0, 1 - row.goals_against / row.played),
    }
  }

  const homeRates = getTeamRates(homeRow)
  const awayRates = getTeamRates(awayRow)

  const validTeams = standingsData.filter(s => s.played > 0)
  const leagueAvgAttack = validTeams.length > 0
    ? validTeams.reduce((sum, s) => sum + s.goals_for / s.played, 0) / validTeams.length
    : leagueAvgGoalsPerMatch / 2
  const leagueAvgDefence = validTeams.length > 0
    ? validTeams.reduce((sum, s) => sum + s.goals_against / s.played, 0) / validTeams.length
    : leagueAvgGoalsPerMatch / 2

  const homeAttackStrength = homeRates.attack / (leagueAvgAttack || 1.3)
  const homeDefenceStrength = homeRates.defence / (leagueAvgDefence || 1.3)
  const awayAttackStrength = awayRates.attack / (leagueAvgAttack || 1.3)
  const awayDefenceStrength = awayRates.defence / (leagueAvgDefence || 1.3)

  const homeAdvantage = 1.10
  let homeLam = homeAttackStrength * awayDefenceStrength * leagueAvgAttack * homeAdvantage
  let awayLam = awayAttackStrength * homeDefenceStrength * leagueAvgAttack

  if (homeRow && awayRow) {
    const positionDiff = (awayRow.position - homeRow.position) / totalTeams
    homeLam *= 1 + positionDiff * 0.12
    awayLam *= 1 - positionDiff * 0.12
  }

  const avgPPG = 1.5
  homeLam *= Math.min(1.08, Math.max(0.92, 1 + (homeRates.ppg - avgPPG) * 0.05))
  awayLam *= Math.min(1.08, Math.max(0.92, 1 + (awayRates.ppg - avgPPG) * 0.05))

  // ── Ajuste con estadísticas extendidas de SofaScore ──────────────────────
  homeLam = adjustLambdaWithExtStats(homeLam, enrichedData.homeExtStats, enrichedData.awayExtStats, true)
  awayLam = adjustLambdaWithExtStats(awayLam, enrichedData.awayExtStats, enrichedData.homeExtStats, false)

  // ── Ajuste H2H (si hay datos) ─────────────────────────────────────────────
  if (enrichedData.h2h && enrichedData.h2h.totalMatches >= 3) {
    const h2h = enrichedData.h2h
    const h2hAvgTotal = h2h.avgGoalsPerMatch
    const currentAvg = homeLam + awayLam
    // Ponderar levemente con el promedio H2H (20%)
    const h2hAdjFactor = h2hAvgTotal / (currentAvg || 2.5)
    homeLam *= 0.85 + h2hAdjFactor * 0.15
    awayLam *= 0.85 + h2hAdjFactor * 0.15

    // Si históricamente el equipo local domina el H2H
    const h2hHomeAdv = h2h.homeTeamWins / h2h.totalMatches
    if (h2hHomeAdv > 0.6) homeLam *= 1.04
    else if (h2hHomeAdv < 0.3) awayLam *= 1.04
  }

  homeLam = Math.max(0.25, Math.min(4.5, homeLam))
  awayLam = Math.max(0.18, Math.min(3.8, awayLam))

  // ── Matriz Poisson ────────────────────────────────────────────────────────
  const { homeWin, draw, awayWin, scoreProbs } = poissonMatrix(homeLam, awayLam)
  const total = homeWin + draw + awayWin
  const hwProb = (homeWin / total) * 100
  const dProb  = (draw / total) * 100
  const awProb = (awayWin / total) * 100

  // ── Mercados de goles ─────────────────────────────────────────────────────
  const over05 = calcOver(homeLam, awayLam, 0.5)
  const over15 = calcOver(homeLam, awayLam, 1.5)
  const over25 = calcOver(homeLam, awayLam, 2.5)
  const over35 = calcOver(homeLam, awayLam, 3.5)
  const over45 = calcOver(homeLam, awayLam, 4.5)
  const under15 = 100 - over15
  const under25 = 100 - over25
  const under35 = 100 - over35
  const btts = calcBtts(homeLam, awayLam)
  const bttsNo = 100 - btts

  // ── Primera mitad (~43% de goles) ────────────────────────────────────────
  const htHomeLam = homeLam * 0.43
  const htAwayLam = awayLam * 0.43
  const htMatrix = poissonMatrix(htHomeLam, htAwayLam, 5)
  const htTotal = htMatrix.homeWin + htMatrix.draw + htMatrix.awayWin
  const htHomeWin = (htMatrix.homeWin / htTotal) * 100
  const htDraw = (htMatrix.draw / htTotal) * 100
  const htAwayWin = (htMatrix.awayWin / htTotal) * 100
  const htOver05 = calcOver(htHomeLam, htAwayLam, 0.5)
  const htOver15 = calcOver(htHomeLam, htAwayLam, 1.5)
  const bttsHT = calcBtts(htHomeLam, htAwayLam)

  // Resultado final más probable en 1ª mitad
  const htTopScore = htMatrix.scoreProbs[0]

  // ── Segunda mitad (~57% de goles) ────────────────────────────────────────
  const stHomeLam = homeLam * 0.57
  const stAwayLam = awayLam * 0.57
  const stOver05 = calcOver(stHomeLam, stAwayLam, 0.5)
  const stOver15 = calcOver(stHomeLam, stAwayLam, 1.5)

  // ── Distribución de total de goles ───────────────────────────────────────
  const goalsDist = calcTotalGoalsDistribution(homeLam, awayLam)
  const totalGoalsExpected = parseFloat((homeLam + awayLam).toFixed(2))
  const totalGoalsMostLikely = Object.entries(goalsDist).sort((a, b) => Number(b[1]) - Number(a[1]))[0]

  // ── Doble oportunidad ─────────────────────────────────────────────────────
  const dc1X = Math.min(99, hwProb + dProb)
  const dcX2 = Math.min(99, dProb + awProb)
  const dc12 = Math.min(99, hwProb + awProb)

  // ── Quién anota primero ───────────────────────────────────────────────────
  const firstGoal = calcFirstGoalScorer(homeLam, awayLam)

  // ── Hándicap asiático ─────────────────────────────────────────────────────
  let handicapLine = '0'
  if (hwProb > awProb + 20) handicapLine = '-0.75'
  else if (hwProb > awProb + 12) handicapLine = '-0.5'
  else if (hwProb > awProb + 5) handicapLine = '-0.25'
  else if (awProb > hwProb + 20) handicapLine = '+0.75'
  else if (awProb > hwProb + 12) handicapLine = '+0.5'
  else if (awProb > hwProb + 5) handicapLine = '+0.25'
  const ahHomeProb = calcAsianHandicap(homeLam, awayLam, parseFloat(handicapLine.replace('+', '')))

  // ── Corners ───────────────────────────────────────────────────────────────
  let baseCorners = 9.5
  let homeCornerBase = 5.2, awayCornerBase = 4.8

  if (enrichedData.homeExtStats?.avgCornersFor && enrichedData.awayExtStats?.avgCornersFor) {
    homeCornerBase = (enrichedData.homeExtStats.avgCornersFor + enrichedData.awayExtStats.avgCornersAgainst) / 2
    awayCornerBase = (enrichedData.awayExtStats.avgCornersFor + enrichedData.homeExtStats.avgCornersAgainst) / 2
    baseCorners = homeCornerBase + awayCornerBase
  } else {
    const cornerFactor = 3.8
    baseCorners = 9.5 + (homeLam + awayLam - 2.5) * cornerFactor
    homeCornerBase = baseCorners * 0.55
    awayCornerBase = baseCorners * 0.45
  }

  const totalExpCorners = Math.round(baseCorners)
  const homeCorners = Math.round(homeCornerBase)
  const awayCorners = totalExpCorners - homeCorners
  const cornersOver85 = Math.max(20, Math.min(85, calcOver(homeCornerBase, awayCornerBase, 8.5)))
  const cornersOver95 = Math.max(15, Math.min(75, calcOver(homeCornerBase, awayCornerBase, 9.5)))
  const cornersOver105 = Math.max(10, Math.min(65, calcOver(homeCornerBase, awayCornerBase, 10.5)))
  const cornersOver115 = Math.max(5, Math.min(50, calcOver(homeCornerBase, awayCornerBase, 11.5)))

  // ── Tarjetas ──────────────────────────────────────────────────────────────
  let baseCards = 3.2, homeCardBase = 1.6, awayCardBase = 1.6

  if (enrichedData.homeExtStats?.avgYellowCards && enrichedData.awayExtStats?.avgYellowCards) {
    homeCardBase = enrichedData.homeExtStats.avgYellowCards
    awayCardBase = enrichedData.awayExtStats.avgYellowCards
    baseCards = homeCardBase + awayCardBase
  } else {
    const competitiveness = Math.abs(hwProb - awProb) < 15 ? 1.1 : 1.0
    baseCards = (3.2 + (homeLam + awayLam - 2.5) * 0.8) * competitiveness
    homeCardBase = baseCards * 0.5
    awayCardBase = baseCards * 0.5
  }

  const totalExpCards = parseFloat(baseCards.toFixed(1))
  const homeCards = Math.round(homeCardBase)
  const awayCards = Math.round(awayCardBase)
  const cardsOver25 = Math.max(15, Math.min(85, 45 + (totalExpCards - 3.0) * 18))
  const cardsOver35 = Math.max(15, Math.min(80, 35 + (totalExpCards - 3.5) * 15))
  const cardsOver45 = Math.max(10, Math.min(65, 25 + (totalExpCards - 3.5) * 12))
  const cardsOver55 = Math.max(5, Math.min(45, 15 + (totalExpCards - 4.0) * 10))

  // ── Marcadores exactos top 16 ─────────────────────────────────────────────
  const topScores = scoreProbs.slice(0, 16)
  const topScoreResult = topScores[0]

  // ── Goleador del partido ──────────────────────────────────────────────────
  const scorerOdds = enrichedData.topScorers && enrichedData.topScorers.length > 0
    ? calcTopScorerOdds(enrichedData.topScorers, homeTeam.id, awayTeam.id, homeLam, awayLam)
    : []

  // ── Confianza del modelo ──────────────────────────────────────────────────
  const hasStandingsData = homeRow && awayRow && homeRow.played > 3 && awayRow.played > 3
  const hasExtData = !!(enrichedData.homeExtStats && enrichedData.awayExtStats)
  const hasH2H = !!(enrichedData.h2h && enrichedData.h2h.totalMatches > 0)
  const hasTopScorers = !!(enrichedData.topScorers && enrichedData.topScorers.length > 0)
  const dataQuality = (hasStandingsData ? 20 : 0) + (hasExtData ? 25 : 0) + (hasH2H ? 15 : 0) + (hasTopScorers ? 10 : 0)
  const confidence = Math.min(92, 40 + dataQuality)
  const confidenceLabel = confidence >= 75 ? 'Alta' : confidence >= 58 ? 'Media' : 'Baja'

  // ── Análisis textual ──────────────────────────────────────────────────────
  const analyses: string[] = []

  if (hwProb > 50) {
    const margin = hwProb - awProb
    const strength = margin > 20 ? 'clara' : margin > 10 ? 'moderada' : 'ligera'
    analyses.push(`${homeTeam.name} parte como favorito en casa con ventaja ${strength} (${hwProb.toFixed(1)}% vs ${awProb.toFixed(1)}%).`)
  } else if (awProb > 50) {
    analyses.push(`${awayTeam.name} se postula como favorito visitante (${awProb.toFixed(1)}%), señalando una brecha de calidad significativa.`)
  } else {
    analyses.push(`Partido equilibrado: el empate (${dProb.toFixed(1)}%) compite directamente con ambas victorias. Cualquier resultado es viable.`)
  }

  const totalXG = homeLam + awayLam
  if (totalXG > 3.2) {
    analyses.push(`Alta producción ofensiva esperada: ${totalXG.toFixed(1)} goles xG. Over 2.5 (${over25.toFixed(0)}%) y BTTS (${btts.toFixed(0)}%) tienen valor.`)
  } else if (totalXG < 2.0) {
    analyses.push(`Partido defensivo previsto (${totalXG.toFixed(1)} xG totales). Under 2.5 (${under25.toFixed(0)}%) es la opción con más respaldo estadístico.`)
  } else {
    analyses.push(`Producción ofensiva moderada (${totalXG.toFixed(1)} xG). Over 2.5 al ${over25.toFixed(0)}%, en zona de decisión.`)
  }

  if (btts > 62) {
    analyses.push(`Ambos equipos tienen tendencia a marcar: BTTS al ${btts.toFixed(0)}%. Los registros de goles concedidos de ambos reflejan defensas permeables.`)
  } else if (btts < 40) {
    analyses.push(`Alta probabilidad de que al menos un equipo no marque (${(100 - btts).toFixed(0)}% BTTS-No). Se espera partido a cero para el más débil.`)
  }

  if (enrichedData.h2h && enrichedData.h2h.totalMatches >= 3) {
    const h2h = enrichedData.h2h
    analyses.push(`H2H: en los últimos ${h2h.totalMatches} enfrentamientos, ${homeTeam.name} ganó ${h2h.homeTeamWins} veces, ${h2h.awayTeamWins} victorias visitantes y ${h2h.draws} empates. Media de ${h2h.avgGoalsPerMatch.toFixed(1)} goles por partido.`)
  }

  if (enrichedData.homeExtStats && enrichedData.awayExtStats) {
    const homeForm = enrichedData.homeExtStats.recentForm.join('')
    const awayForm = enrichedData.awayExtStats.recentForm.join('')
    if (homeForm || awayForm) {
      analyses.push(`Forma reciente: ${homeTeam.name} [${homeForm}] | ${awayTeam.name} [${awayForm}].`)
    }
  }

  if (totalExpCorners > 11) {
    analyses.push(`Partido con alto potencial de córners (~${totalExpCorners} esperados). Over 9.5 corners: ${cornersOver95.toFixed(0)}%.`)
  }

  // ── Value Bets ────────────────────────────────────────────────────────────
  const valueBets: string[] = []
  if (over25 > 62) valueBets.push(`Over 2.5 (${over25.toFixed(0)}%)`)
  if (btts > 62) valueBets.push(`BTTS Sí (${btts.toFixed(0)}%)`)
  if (hwProb > 58) valueBets.push(`Victoria Local (${hwProb.toFixed(0)}%)`)
  if (awProb > 52) valueBets.push(`Victoria Visitante (${awProb.toFixed(0)}%)`)
  if (under25 > 55) valueBets.push(`Under 2.5 (${under25.toFixed(0)}%)`)
  if (over15 > 80) valueBets.push(`Over 1.5 (${over15.toFixed(0)}%)`)
  if (dc1X > 78 && hwProb > 45) valueBets.push(`Doble Oportunidad 1X (${dc1X.toFixed(0)}%)`)
  if (dcX2 > 78 && awProb > 40) valueBets.push(`Doble Oportunidad X2 (${dcX2.toFixed(0)}%)`)

  // ── Resultado final ───────────────────────────────────────────────────────
  return {
    // Identidad
    home_team: homeTeam.name,
    away_team: awayTeam.name,
    home_team_id: homeTeam.id,
    away_team_id: awayTeam.id,
    home_team_logo: homeTeam.logo,
    away_team_logo: awayTeam.logo,

    // 1X2 principal
    home_win_probability: parseFloat(hwProb.toFixed(2)),
    draw_probability: parseFloat(dProb.toFixed(2)),
    away_win_probability: parseFloat(awProb.toFixed(2)),
    predicted_result: hwProb > awProb ? 'home' : awProb > hwProb ? 'away' : 'draw',
    predicted_home_goals: topScoreResult.home,
    predicted_away_goals: topScoreResult.away,

    // Lambdas
    home_lambda: parseFloat(homeLam.toFixed(3)),
    away_lambda: parseFloat(awayLam.toFixed(3)),

    // Confianza
    confidence: parseFloat(confidence.toFixed(1)),
    confidence_label: confidenceLabel,
    data_sources: {
      standings: !!(homeRow && awayRow),
      extended_stats: hasExtData,
      h2h: hasH2H,
      top_scorers: hasTopScorers,
    },

    // ── GANADOR ──────────────────────────────────────────────────────────────
    winner: {
      home: parseFloat(hwProb.toFixed(2)),
      draw: parseFloat(dProb.toFixed(2)),
      away: parseFloat(awProb.toFixed(2)),
      favorite: hwProb > awProb ? homeTeam.name : awProb > hwProb ? awayTeam.name : 'Empate',
    },

    // ── DOBLE OPORTUNIDAD ────────────────────────────────────────────────────
    double_chance: {
      home_draw: parseFloat(dc1X.toFixed(2)),
      draw_away: parseFloat(dcX2.toFixed(2)),
      home_away: parseFloat(dc12.toFixed(2)),
    },

    // ── AMBOS ANOTAN ─────────────────────────────────────────────────────────
    btts: {
      yes: parseFloat(btts.toFixed(2)),
      no: parseFloat(bttsNo.toFixed(2)),
    },

    // ── MÁS/MENOS DE GOLES ──────────────────────────────────────────────────
    goals: {
      over_05: parseFloat(over05.toFixed(2)),
      over_15: parseFloat(over15.toFixed(2)),
      under_15: parseFloat(under15.toFixed(2)),
      over_25: parseFloat(over25.toFixed(2)),
      under_25: parseFloat(under25.toFixed(2)),
      over_35: parseFloat(over35.toFixed(2)),
      under_35: parseFloat(under35.toFixed(2)),
      over_45: parseFloat(over45.toFixed(2)),
      // Legacy compat
      over_25_bool: over25 > 50,
    },

    // ── RESULTADO AL DESCANSO ────────────────────────────────────────────────
    half_time: {
      home_win: parseFloat(htHomeWin.toFixed(2)),
      draw: parseFloat(htDraw.toFixed(2)),
      away_win: parseFloat(htAwayWin.toFixed(2)),
      most_likely_score: `${htTopScore.home}-${htTopScore.away}`,
      over_05: parseFloat(htOver05.toFixed(2)),
      over_15: parseFloat(htOver15.toFixed(2)),
      btts: parseFloat(bttsHT.toFixed(2)),
    },

    // ── SEGUNDA MITAD ────────────────────────────────────────────────────────
    second_half: {
      over_05: parseFloat(stOver05.toFixed(2)),
      over_15: parseFloat(stOver15.toFixed(2)),
    },

    // ── RESULTADO FINAL (marcador exacto) ────────────────────────────────────
    exact_score: {
      most_likely: `${topScoreResult.home}-${topScoreResult.away}`,
      top_scores: topScores.map(s => ({
        score: `${s.home}-${s.away}`,
        home: s.home,
        away: s.away,
        prob: parseFloat(s.prob.toFixed(2)),
      })),
    },

    // ── TOTAL DE GOLES ───────────────────────────────────────────────────────
    total_goals: {
      expected: totalGoalsExpected,
      most_likely: Number(totalGoalsMostLikely?.[0]) || 2,
      distribution: Object.entries(goalsDist)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .slice(0, 8)
        .map(([goals, prob]) => ({
          goals: Number(goals),
          prob: parseFloat(((prob as number) * 100).toFixed(2)),
        })),
    },

    // ── EQUIPO QUE ANOTA PRIMERO ─────────────────────────────────────────────
    first_goal: {
      home_team: firstGoal.homeFirst,
      away_team: firstGoal.awayFirst,
      no_goal: firstGoal.noGoalGame,
      favorite: firstGoal.homeFirst > firstGoal.awayFirst ? homeTeam.name : awayTeam.name,
    },

    // ── CORNERS ──────────────────────────────────────────────────────────────
    corners: {
      expected_total: totalExpCorners,
      expected_home: homeCorners,
      expected_away: awayCorners,
      over_85: parseFloat(cornersOver85.toFixed(1)),
      over_95: parseFloat(cornersOver95.toFixed(1)),
      over_105: parseFloat(cornersOver105.toFixed(1)),
      over_115: parseFloat(cornersOver115.toFixed(1)),
      // Datos históricos si están disponibles
      home_avg_for: enrichedData.homeExtStats?.avgCornersFor,
      away_avg_for: enrichedData.awayExtStats?.avgCornersFor,
      home_avg_against: enrichedData.homeExtStats?.avgCornersAgainst,
      away_avg_against: enrichedData.awayExtStats?.avgCornersAgainst,
    },

    // ── TARJETAS ──────────────────────────────────────────────────────────────
    cards: {
      expected_total: totalExpCards,
      expected_home: homeCards,
      expected_away: awayCards,
      over_25: parseFloat(cardsOver25.toFixed(1)),
      over_35: parseFloat(cardsOver35.toFixed(1)),
      over_45: parseFloat(cardsOver45.toFixed(1)),
      over_55: parseFloat(cardsOver55.toFixed(1)),
      home_avg: enrichedData.homeExtStats?.avgYellowCards,
      away_avg: enrichedData.awayExtStats?.avgYellowCards,
    },

    // ── GOLEADORES DEL PARTIDO ───────────────────────────────────────────────
    top_scorers: scorerOdds,

    // ── HÁNDICAP ASIÁTICO ────────────────────────────────────────────────────
    asian_handicap: {
      line: handicapLine,
      home_prob: parseFloat(ahHomeProb.toFixed(2)),
      away_prob: parseFloat((100 - ahHomeProb).toFixed(2)),
    },

    // ── H2H ──────────────────────────────────────────────────────────────────
    head_to_head: enrichedData.h2h ? {
      total_matches: enrichedData.h2h.totalMatches,
      home_wins: enrichedData.h2h.homeTeamWins,
      away_wins: enrichedData.h2h.awayTeamWins,
      draws: enrichedData.h2h.draws,
      avg_goals: enrichedData.h2h.avgGoalsPerMatch,
      btts_rate: enrichedData.h2h.bttsRate,
      over25_rate: enrichedData.h2h.over25Rate,
      recent_matches: enrichedData.h2h.recentMatches,
    } : null,

    // ── ESTADÍSTICAS EXTENDIDAS DE EQUIPOS ───────────────────────────────────
    home_extended_stats: enrichedData.homeExtStats ? {
      form: enrichedData.homeExtStats.recentForm,
      avg_goals_scored: enrichedData.homeExtStats.avgGoalsScored,
      avg_goals_conceded: enrichedData.homeExtStats.avgGoalsConceded,
      avg_goals_home: enrichedData.homeExtStats.avgGoalsScoredHome,
      avg_goals_away: enrichedData.homeExtStats.avgGoalsScoredAway,
      win_pct: enrichedData.homeExtStats.winPct,
      draw_pct: enrichedData.homeExtStats.drawPct,
      loss_pct: enrichedData.homeExtStats.lossPct,
      clean_sheet_pct: enrichedData.homeExtStats.cleanSheetPct,
      btts_rate: enrichedData.homeExtStats.bttsRate,
      over25_rate: enrichedData.homeExtStats.over25Rate,
      avg_corners_for: enrichedData.homeExtStats.avgCornersFor,
      avg_corners_against: enrichedData.homeExtStats.avgCornersAgainst,
      avg_yellow_cards: enrichedData.homeExtStats.avgYellowCards,
      avg_shots_on_target: enrichedData.homeExtStats.avgShotsOnTarget,
      avg_possession: enrichedData.homeExtStats.avgPossession,
      avg_xg_for: enrichedData.homeExtStats.avgXgFor,
      avg_xg_against: enrichedData.homeExtStats.avgXgAgainst,
    } : null,
    away_extended_stats: enrichedData.awayExtStats ? {
      form: enrichedData.awayExtStats.recentForm,
      avg_goals_scored: enrichedData.awayExtStats.avgGoalsScored,
      avg_goals_conceded: enrichedData.awayExtStats.avgGoalsConceded,
      avg_goals_home: enrichedData.awayExtStats.avgGoalsScoredHome,
      avg_goals_away: enrichedData.awayExtStats.avgGoalsScoredAway,
      win_pct: enrichedData.awayExtStats.winPct,
      draw_pct: enrichedData.awayExtStats.drawPct,
      loss_pct: enrichedData.awayExtStats.lossPct,
      clean_sheet_pct: enrichedData.awayExtStats.cleanSheetPct,
      btts_rate: enrichedData.awayExtStats.bttsRate,
      over25_rate: enrichedData.awayExtStats.over25Rate,
      avg_corners_for: enrichedData.awayExtStats.avgCornersFor,
      avg_corners_against: enrichedData.awayExtStats.avgCornersAgainst,
      avg_yellow_cards: enrichedData.awayExtStats.avgYellowCards,
      avg_shots_on_target: enrichedData.awayExtStats.avgShotsOnTarget,
      avg_possession: enrichedData.awayExtStats.avgPossession,
      avg_xg_for: enrichedData.awayExtStats.avgXgFor,
      avg_xg_against: enrichedData.awayExtStats.avgXgAgainst,
    } : null,

    // ── STATS DE TABLA (legacy compat) ────────────────────────────────────────
    home_stats: homeRow ? {
      position: homeRow.position,
      played: homeRow.played,
      won: homeRow.won,
      draw: homeRow.draw,
      lost: homeRow.lost,
      goals_for: homeRow.goals_for,
      goals_against: homeRow.goals_against,
      points: homeRow.points,
      attack_strength: parseFloat(homeAttackStrength.toFixed(3)),
      defence_strength: parseFloat(homeDefenceStrength.toFixed(3)),
    } : null,
    away_stats: awayRow ? {
      position: awayRow.position,
      played: awayRow.played,
      won: awayRow.won,
      draw: awayRow.draw,
      lost: awayRow.lost,
      goals_for: awayRow.goals_for,
      goals_against: awayRow.goals_against,
      points: awayRow.points,
      attack_strength: parseFloat(awayAttackStrength.toFixed(3)),
      defence_strength: parseFloat(awayDefenceStrength.toFixed(3)),
    } : null,

    // Legacy compat fields
    over_05_prob: parseFloat(over05.toFixed(2)),
    over_15_prob: parseFloat(over15.toFixed(2)),
    over_25_prob: parseFloat(over25.toFixed(2)),
    over_25: over25 > 50,
    over_35_prob: parseFloat(over35.toFixed(2)),
    over_45_prob: parseFloat(over45.toFixed(2)),
    btts_prob: parseFloat(btts.toFixed(2)),
    btts_bool: btts > 50,
    btts_ht: parseFloat(bttsHT.toFixed(2)),
    dc_home: parseFloat(dc1X.toFixed(2)),
    dc_draw_away: parseFloat(dcX2.toFixed(2)),
    dc_both: parseFloat(dc12.toFixed(2)),
    handicap_line: handicapLine,
    ah_home_prob: parseFloat(ahHomeProb.toFixed(2)),
    expected_corners: totalExpCorners,
    home_corners_exp: homeCorners,
    away_corners_exp: awayCorners,
    corners_over_8: parseFloat(cornersOver85.toFixed(1)),
    corners_over_9: parseFloat(cornersOver95.toFixed(1)),
    corners_over_10: parseFloat(cornersOver105.toFixed(1)),
    expected_cards: parseFloat(totalExpCards.toFixed(1)),
    home_cards_exp: homeCards,
    away_cards_exp: awayCards,
    cards_over_3: parseFloat(cardsOver35.toFixed(1)),
    cards_over_4: parseFloat(cardsOver45.toFixed(1)),
    first_half: {
      home_win: parseFloat(htHomeWin.toFixed(2)),
      draw: parseFloat(htDraw.toFixed(2)),
      away_win: parseFloat(htAwayWin.toFixed(2)),
      over_05: parseFloat(htOver05.toFixed(2)),
      over_15_ht: parseFloat(htOver15.toFixed(2)),
      btts_ht: parseFloat(bttsHT.toFixed(2)),
    },
    home_score_first: firstGoal.homeFirst,
    no_goal_first_30: firstGoal.noGoalGame,
    top_scores: topScores.slice(0, 12).map(s => ({ home: s.home, away: s.away, prob: parseFloat(s.prob.toFixed(2)) })),

    analysis: analyses,
    value_bets: valueBets,
  }
}

// ─── Fallback standings ───────────────────────────────────────────────────────
import { FALLBACK_STANDINGS } from '@/lib/fallback-data'

// ─── POST endpoint ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { home_team_id, away_team_id, league, home_team_name, away_team_name } = body

    if (!home_team_id || !away_team_id || !league) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 })
    }
    if (home_team_id === away_team_id) {
      return NextResponse.json({ error: 'Los equipos deben ser diferentes' }, { status: 400 })
    }

    const tournamentConfig = TOURNAMENT_IDS[league]
    if (!tournamentConfig) {
      return NextResponse.json({ error: `Liga '${league}' no soportada` }, { status: 404 })
    }

    // Fetch standings y datos enriquecidos en paralelo
    const [standingsResult, enrichedResult] = await Promise.allSettled([
      getTournamentStandings(tournamentConfig.id, tournamentConfig.seasonId),
      getEnrichedPredictionData(
        Number(home_team_id),
        Number(away_team_id),
        tournamentConfig.id,
        tournamentConfig.seasonId
      ),
    ])

    let standingsRaw: StandingsRow[] = []
    if (standingsResult.status === 'fulfilled' && standingsResult.value.length > 0) {
      standingsRaw = standingsResult.value.map(s => ({
        position: s.position,
        team_name: s.team.name,
        team_id: s.team.id,
        played: s.matches,
        won: s.wins,
        draw: s.draws,
        lost: s.losses,
        goals_for: s.scoresFor,
        goals_against: s.scoresAgainst,
        points: s.points,
      }))
    }

    if (standingsRaw.length === 0) {
      standingsRaw = (FALLBACK_STANDINGS as any)[league] || []
    }

    const enrichedData = enrichedResult.status === 'fulfilled' ? enrichedResult.value : {}

    const homeTeam = {
      id: Number(home_team_id),
      name: home_team_name || 'Local',
      logo: getTeamLogoUrl(Number(home_team_id)),
    }
    const awayTeam = {
      id: Number(away_team_id),
      name: away_team_name || 'Visitante',
      logo: getTeamLogoUrl(Number(away_team_id)),
    }

    const prediction = buildPrediction(homeTeam, awayTeam, standingsRaw, enrichedData)

    return NextResponse.json(prediction)
  } catch (error) {
    console.error('[Predict] Error:', error)
    return NextResponse.json({ error: 'Error interno al predecir' }, { status: 500 })
  }
}