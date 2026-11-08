/**
 * Datos de respaldo para ligas cuando SofaScore no está disponible.
 * Temporada 2024-2025
 */

export interface FallbackStanding {
  position: number
  team_name: string
  team_id: number
  team_logo: string
  played: number
  won: number
  draw: number
  lost: number
  goals_for: number
  goals_against: number
  goal_diff: number
  points: number
}

export const FALLBACK_STANDINGS: Record<string, FallbackStanding[]> = {
  spain_laliga: [
    { position: 1, team_name: 'Real Madrid', team_id: 2829, team_logo: '', played: 38, won: 29, draw: 5, lost: 4, goals_for: 87, goals_against: 26, goal_diff: 61, points: 92 },
    { position: 2, team_name: 'FC Barcelona', team_id: 2817, team_logo: '', played: 38, won: 26, draw: 7, lost: 5, goals_for: 79, goals_against: 45, goal_diff: 34, points: 85 },
    { position: 3, team_name: 'Girona FC', team_id: 2859, team_logo: '', played: 38, won: 25, draw: 6, lost: 7, goals_for: 85, goals_against: 46, goal_diff: 39, points: 81 },
    { position: 4, team_name: 'Atlético Madrid', team_id: 2836, team_logo: '', played: 38, won: 24, draw: 4, lost: 10, goals_for: 70, goals_against: 43, goal_diff: 27, points: 76 },
    { position: 5, team_name: 'Athletic Club', team_id: 2848, team_logo: '', played: 38, won: 19, draw: 11, lost: 8, goals_for: 61, goals_against: 37, goal_diff: 24, points: 68 },
    { position: 6, team_name: 'Real Betis', team_id: 2816, team_logo: '', played: 38, won: 17, draw: 10, lost: 11, goals_for: 48, goals_against: 45, goal_diff: 3, points: 61 },
    { position: 7, team_name: 'Real Sociedad', team_id: 2869, team_logo: '', played: 38, won: 16, draw: 12, lost: 10, goals_for: 51, goals_against: 39, goal_diff: 12, points: 60 },
    { position: 8, team_name: 'Villarreal', team_id: 2815, team_logo: '', played: 38, won: 15, draw: 13, lost: 10, goals_for: 65, goals_against: 57, goal_diff: 8, points: 58 },
    { position: 9, team_name: 'Valencia CF', team_id: 2831, team_logo: '', played: 38, won: 13, draw: 13, lost: 12, goals_for: 42, goals_against: 43, goal_diff: -1, points: 52 },
    { position: 10, team_name: 'Sevilla FC', team_id: 2833, team_logo: '', played: 38, won: 13, draw: 10, lost: 15, goals_for: 51, goals_against: 52, goal_diff: -1, points: 49 },
    { position: 11, team_name: 'Getafe CF', team_id: 2820, team_logo: '', played: 38, won: 12, draw: 13, lost: 13, goals_for: 41, goals_against: 51, goal_diff: -10, points: 49 },
    { position: 12, team_name: 'CA Osasuna', team_id: 2821, team_logo: '', played: 38, won: 12, draw: 12, lost: 14, goals_for: 46, goals_against: 55, goal_diff: -9, points: 48 },
    { position: 13, team_name: 'Celta de Vigo', team_id: 2825, team_logo: '', played: 38, won: 12, draw: 11, lost: 15, goals_for: 53, goals_against: 53, goal_diff: 0, points: 47 },
    { position: 14, team_name: 'Rayo Vallecano', team_id: 2853, team_logo: '', played: 38, won: 11, draw: 13, lost: 14, goals_for: 37, goals_against: 47, goal_diff: -10, points: 46 },
    { position: 15, team_name: 'RCD Mallorca', team_id: 2824, team_logo: '', played: 38, won: 11, draw: 12, lost: 15, goals_for: 33, goals_against: 44, goal_diff: -11, points: 45 },
    { position: 16, team_name: 'UD Las Palmas', team_id: 2857, team_logo: '', played: 38, won: 10, draw: 11, lost: 17, goals_for: 41, goals_against: 55, goal_diff: -14, points: 41 },
    { position: 17, team_name: 'Deportivo Alavés', team_id: 2819, team_logo: '', played: 38, won: 10, draw: 8, lost: 20, goals_for: 36, goals_against: 54, goal_diff: -18, points: 38 },
    { position: 18, team_name: 'Cádiz CF', team_id: 2852, team_logo: '', played: 38, won: 6, draw: 15, lost: 17, goals_for: 28, goals_against: 51, goal_diff: -23, points: 33 },
    { position: 19, team_name: 'Granada CF', team_id: 2868, team_logo: '', played: 38, won: 4, draw: 11, lost: 23, goals_for: 38, goals_against: 73, goal_diff: -35, points: 23 },
    { position: 20, team_name: 'UD Almería', team_id: 2863, team_logo: '', played: 38, won: 3, draw: 8, lost: 27, goals_for: 43, goals_against: 79, goal_diff: -36, points: 17 },
  ],
  england_premier_league: [
    { position: 1, team_name: 'Liverpool', team_id: 44, team_logo: '', played: 38, won: 31, draw: 6, lost: 1, goals_for: 86, goals_against: 29, goal_diff: 57, points: 99 },
    { position: 2, team_name: 'Arsenal', team_id: 42, team_logo: '', played: 38, won: 26, draw: 7, lost: 5, goals_for: 88, goals_against: 40, goal_diff: 48, points: 85 },
    { position: 3, team_name: 'Manchester City', team_id: 17, team_logo: '', played: 38, won: 21, draw: 8, lost: 9, goals_for: 80, goals_against: 49, goal_diff: 31, points: 71 },
    { position: 4, team_name: 'Chelsea', team_id: 38, team_logo: '', played: 38, won: 20, draw: 9, lost: 9, goals_for: 78, goals_against: 57, goal_diff: 21, points: 69 },
    { position: 5, team_name: 'Nottingham Forest', team_id: 14, team_logo: '', played: 38, won: 20, draw: 7, lost: 11, goals_for: 60, goals_against: 50, goal_diff: 10, points: 67 },
    { position: 6, team_name: 'Newcastle United', team_id: 39, team_logo: '', played: 38, won: 18, draw: 8, lost: 12, goals_for: 70, goals_against: 53, goal_diff: 17, points: 62 },
    { position: 7, team_name: 'Aston Villa', team_id: 40, team_logo: '', played: 38, won: 17, draw: 8, lost: 13, goals_for: 71, goals_against: 61, goal_diff: 10, points: 59 },
    { position: 8, team_name: 'Brentford', team_id: 7, team_logo: '', played: 38, won: 17, draw: 6, lost: 15, goals_for: 66, goals_against: 64, goal_diff: 2, points: 57 },
    { position: 9, team_name: 'Brighton', team_id: 3, team_logo: '', played: 38, won: 15, draw: 10, lost: 13, goals_for: 66, goals_against: 64, goal_diff: 2, points: 55 },
    { position: 10, team_name: 'Fulham', team_id: 36, team_logo: '', played: 38, won: 14, draw: 9, lost: 15, goals_for: 55, goals_against: 58, goal_diff: -3, points: 51 },
    { position: 11, team_name: 'Tottenham Hotspur', team_id: 33, team_logo: '', played: 38, won: 13, draw: 9, lost: 16, goals_for: 63, goals_against: 71, goal_diff: -8, points: 48 },
    { position: 12, team_name: 'Bournemouth', team_id: 30, team_logo: '', played: 38, won: 13, draw: 8, lost: 17, goals_for: 51, goals_against: 62, goal_diff: -11, points: 47 },
    { position: 13, team_name: 'Manchester United', team_id: 35, team_logo: '', played: 38, won: 13, draw: 7, lost: 18, goals_for: 47, goals_against: 63, goal_diff: -16, points: 46 },
    { position: 14, team_name: 'West Ham United', team_id: 37, team_logo: '', played: 38, won: 12, draw: 9, lost: 17, goals_for: 51, goals_against: 69, goal_diff: -18, points: 45 },
    { position: 15, team_name: 'Crystal Palace', team_id: 31, team_logo: '', played: 38, won: 11, draw: 9, lost: 18, goals_for: 47, goals_against: 57, goal_diff: -10, points: 42 },
    { position: 16, team_name: 'Everton', team_id: 15, team_logo: '', played: 38, won: 9, draw: 10, lost: 19, goals_for: 40, goals_against: 60, goal_diff: -20, points: 37 },
    { position: 17, team_name: 'Leicester City', team_id: 14, team_logo: '', played: 38, won: 8, draw: 6, lost: 24, goals_for: 42, goals_against: 82, goal_diff: -40, points: 30 },
    { position: 18, team_name: 'Ipswich Town', team_id: 50, team_logo: '', played: 38, won: 5, draw: 9, lost: 24, goals_for: 41, goals_against: 81, goal_diff: -40, points: 24 },
    { position: 19, team_name: 'Southampton', team_id: 45, team_logo: '', played: 38, won: 5, draw: 8, lost: 25, goals_for: 36, goals_against: 87, goal_diff: -51, points: 23 },
    { position: 20, team_name: 'Wolverhampton', team_id: 48, team_logo: '', played: 38, won: 4, draw: 8, lost: 26, goals_for: 37, goals_against: 74, goal_diff: -37, points: 20 },
  ],
  germany_bundesliga: [
    { position: 1, team_name: 'Bayern Munich', team_id: 2673, team_logo: '', played: 34, won: 25, draw: 4, lost: 5, goals_for: 100, goals_against: 40, goal_diff: 60, points: 79 },
    { position: 2, team_name: 'Bayer Leverkusen', team_id: 2672, team_logo: '', played: 34, won: 22, draw: 7, lost: 5, goals_for: 83, goals_against: 38, goal_diff: 45, points: 73 },
    { position: 3, team_name: 'Eintracht Frankfurt', team_id: 2683, team_logo: '', played: 34, won: 18, draw: 7, lost: 9, goals_for: 63, goals_against: 45, goal_diff: 18, points: 61 },
    { position: 4, team_name: 'RB Leipzig', team_id: 2681, team_logo: '', played: 34, won: 17, draw: 8, lost: 9, goals_for: 66, goals_against: 49, goal_diff: 17, points: 59 },
    { position: 5, team_name: 'Borussia Dortmund', team_id: 2675, team_logo: '', played: 34, won: 15, draw: 11, lost: 8, goals_for: 65, goals_against: 49, goal_diff: 16, points: 56 },
    { position: 6, team_name: 'VfB Stuttgart', team_id: 2676, team_logo: '', played: 34, won: 14, draw: 7, lost: 13, goals_for: 60, goals_against: 51, goal_diff: 9, points: 49 },
    { position: 7, team_name: 'Werder Bremen', team_id: 2680, team_logo: '', played: 34, won: 13, draw: 9, lost: 12, goals_for: 53, goals_against: 50, goal_diff: 3, points: 48 },
    { position: 8, team_name: 'Freiburg', team_id: 2693, team_logo: '', played: 34, won: 13, draw: 9, lost: 12, goals_for: 46, goals_against: 53, goal_diff: -7, points: 48 },
  ],
  italy_serie_a: [
    { position: 1, team_name: 'Napoli', team_id: 2714, team_logo: '', played: 38, won: 26, draw: 8, lost: 4, goals_for: 76, goals_against: 30, goal_diff: 46, points: 86 },
    { position: 2, team_name: 'Inter Milan', team_id: 2692, team_logo: '', played: 38, won: 25, draw: 9, lost: 4, goals_for: 87, goals_against: 33, goal_diff: 54, points: 84 },
    { position: 3, team_name: 'Atalanta', team_id: 2681, team_logo: '', played: 38, won: 23, draw: 8, lost: 7, goals_for: 70, goals_against: 38, goal_diff: 32, points: 77 },
    { position: 4, team_name: 'Juventus', team_id: 2687, team_logo: '', played: 38, won: 19, draw: 15, lost: 4, goals_for: 56, goals_against: 29, goal_diff: 27, points: 72 },
    { position: 5, team_name: 'Lazio', team_id: 2718, team_logo: '', played: 38, won: 18, draw: 9, lost: 11, goals_for: 57, goals_against: 47, goal_diff: 10, points: 63 },
    { position: 6, team_name: 'AC Milan', team_id: 2691, team_logo: '', played: 38, won: 16, draw: 10, lost: 12, goals_for: 58, goals_against: 51, goal_diff: 7, points: 58 },
    { position: 7, team_name: 'Fiorentina', team_id: 2715, team_logo: '', played: 38, won: 14, draw: 13, lost: 11, goals_for: 52, goals_against: 46, goal_diff: 6, points: 55 },
    { position: 8, team_name: 'Bologna', team_id: 2677, team_logo: '', played: 38, won: 15, draw: 8, lost: 15, goals_for: 48, goals_against: 50, goal_diff: -2, points: 53 },
  ],
  france_ligue_1: [
    { position: 1, team_name: 'Paris Saint-Germain', team_id: 1644, team_logo: '', played: 34, won: 24, draw: 6, lost: 4, goals_for: 82, goals_against: 33, goal_diff: 49, points: 78 },
    { position: 2, team_name: 'Monaco', team_id: 1649, team_logo: '', played: 34, won: 20, draw: 8, lost: 6, goals_for: 72, goals_against: 45, goal_diff: 27, points: 68 },
    { position: 3, team_name: 'Marseille', team_id: 1641, team_logo: '', played: 34, won: 19, draw: 8, lost: 7, goals_for: 58, goals_against: 40, goal_diff: 18, points: 65 },
    { position: 4, team_name: 'Lille', team_id: 1650, team_logo: '', played: 34, won: 17, draw: 9, lost: 8, goals_for: 51, goals_against: 37, goal_diff: 14, points: 60 },
    { position: 5, team_name: 'Lyon', team_id: 1648, team_logo: '', played: 34, won: 15, draw: 10, lost: 9, goals_for: 52, goals_against: 43, goal_diff: 9, points: 55 },
    { position: 6, team_name: 'Nice', team_id: 1653, team_logo: '', played: 34, won: 14, draw: 9, lost: 11, goals_for: 44, goals_against: 37, goal_diff: 7, points: 51 },
  ],
  mexico_liga_mx: [
    { position: 1, team_name: 'Club América', team_id: 6075, team_logo: '', played: 17, won: 12, draw: 3, lost: 2, goals_for: 32, goals_against: 14, goal_diff: 18, points: 39 },
    { position: 2, team_name: 'Cruz Azul', team_id: 6098, team_logo: '', played: 17, won: 11, draw: 4, lost: 2, goals_for: 30, goals_against: 15, goal_diff: 15, points: 37 },
    { position: 3, team_name: 'Toluca', team_id: 6108, team_logo: '', played: 17, won: 10, draw: 4, lost: 3, goals_for: 28, goals_against: 18, goal_diff: 10, points: 34 },
    { position: 4, team_name: 'Tigres UANL', team_id: 6076, team_logo: '', played: 17, won: 9, draw: 5, lost: 3, goals_for: 26, goals_against: 16, goal_diff: 10, points: 32 },
    { position: 5, team_name: 'Monterrey', team_id: 6099, team_logo: '', played: 17, won: 9, draw: 4, lost: 4, goals_for: 25, goals_against: 18, goal_diff: 7, points: 31 },
    { position: 6, team_name: 'Guadalajara', team_id: 6100, team_logo: '', played: 17, won: 7, draw: 4, lost: 6, goals_for: 22, goals_against: 21, goal_diff: 1, points: 25 },
    { position: 7, team_name: 'Santos Laguna', team_id: 6101, team_logo: '', played: 17, won: 6, draw: 6, lost: 5, goals_for: 19, goals_against: 20, goal_diff: -1, points: 24 },
    { position: 8, team_name: 'Pumas UNAM', team_id: 6102, team_logo: '', played: 17, won: 6, draw: 5, lost: 6, goals_for: 18, goals_against: 21, goal_diff: -3, points: 23 },
  ],
  argentina_liga_profesional: [
    { position: 1, team_name: 'River Plate', team_id: 3211, team_logo: '', played: 25, won: 15, draw: 7, lost: 3, goals_for: 45, goals_against: 23, goal_diff: 22, points: 52 },
    { position: 2, team_name: 'Vélez Sarsfield', team_id: 3202, team_logo: '', played: 25, won: 14, draw: 6, lost: 5, goals_for: 35, goals_against: 15, goal_diff: 20, points: 48 },
    { position: 3, team_name: 'Huracán', team_id: 3224, team_logo: '', played: 25, won: 14, draw: 6, lost: 5, goals_for: 31, goals_against: 18, goal_diff: 13, points: 48 },
    { position: 4, team_name: 'Boca Juniors', team_id: 3220, team_logo: '', played: 25, won: 12, draw: 9, lost: 4, goals_for: 38, goals_against: 21, goal_diff: 17, points: 45 },
    { position: 5, team_name: 'Racing Club', team_id: 3221, team_logo: '', played: 25, won: 11, draw: 9, lost: 5, goals_for: 30, goals_against: 22, goal_diff: 8, points: 42 },
    { position: 6, team_name: 'Independiente', team_id: 3206, team_logo: '', played: 25, won: 10, draw: 8, lost: 7, goals_for: 28, goals_against: 25, goal_diff: 3, points: 38 },
  ],
  brazil_serie_a: [
    { position: 1, team_name: 'Botafogo', team_id: 5924, team_logo: '', played: 38, won: 23, draw: 7, lost: 8, goals_for: 58, goals_against: 34, goal_diff: 24, points: 76 },
    { position: 2, team_name: 'Palmeiras', team_id: 5981, team_logo: '', played: 38, won: 22, draw: 8, lost: 8, goals_for: 66, goals_against: 37, goal_diff: 29, points: 74 },
    { position: 3, team_name: 'Flamengo', team_id: 5926, team_logo: '', played: 38, won: 21, draw: 9, lost: 8, goals_for: 62, goals_against: 43, goal_diff: 19, points: 72 },
    { position: 4, team_name: 'Internacional', team_id: 5974, team_logo: '', played: 38, won: 19, draw: 10, lost: 9, goals_for: 54, goals_against: 37, goal_diff: 17, points: 67 },
    { position: 5, team_name: 'Fortaleza', team_id: 5965, team_logo: '', played: 38, won: 18, draw: 11, lost: 9, goals_for: 55, goals_against: 42, goal_diff: 13, points: 65 },
    { position: 6, team_name: 'Atlético Mineiro', team_id: 5925, team_logo: '', played: 38, won: 17, draw: 10, lost: 11, goals_for: 52, goals_against: 41, goal_diff: 11, points: 61 },
  ],
  champions_league: [
    { position: 1, team_name: 'Liverpool', team_id: 44, team_logo: '', played: 8, won: 7, draw: 1, lost: 0, goals_for: 22, goals_against: 7, goal_diff: 15, points: 22 },
    { position: 2, team_name: 'Barcelona', team_id: 2817, team_logo: '', played: 8, won: 6, draw: 1, lost: 1, goals_for: 18, goals_against: 10, goal_diff: 8, points: 19 },
    { position: 3, team_name: 'Arsenal', team_id: 42, team_logo: '', played: 8, won: 6, draw: 0, lost: 2, goals_for: 20, goals_against: 11, goal_diff: 9, points: 18 },
    { position: 4, team_name: 'Inter Milan', team_id: 2692, team_logo: '', played: 8, won: 5, draw: 2, lost: 1, goals_for: 14, goals_against: 6, goal_diff: 8, points: 17 },
    { position: 5, team_name: 'Bayer Leverkusen', team_id: 2672, team_logo: '', played: 8, won: 5, draw: 2, lost: 1, goals_for: 15, goals_against: 8, goal_diff: 7, points: 17 },
  ],
  europa_league: [
    { position: 1, team_name: 'Athletic Club', team_id: 2848, team_logo: '', played: 8, won: 6, draw: 1, lost: 1, goals_for: 18, goals_against: 7, goal_diff: 11, points: 19 },
    { position: 2, team_name: 'Tottenham Hotspur', team_id: 33, team_logo: '', played: 8, won: 5, draw: 2, lost: 1, goals_for: 16, goals_against: 8, goal_diff: 8, points: 17 },
    { position: 3, team_name: 'Lazio', team_id: 2718, team_logo: '', played: 8, won: 5, draw: 1, lost: 2, goals_for: 14, goals_against: 9, goal_diff: 5, points: 16 },
    { position: 4, team_name: 'Ajax', team_id: 2681, team_logo: '', played: 8, won: 4, draw: 2, lost: 2, goals_for: 13, goals_against: 10, goal_diff: 3, points: 14 },
  ],
}
