/**
 * Football-Data.org API Integration
 * Official provider for structured match, league, and team data
 */

const FOOTBALL_DATA_API = 'https://api.football-data.org/v4';
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// League codes for football-data.org
const LEAGUE_CODES: Record<string, string> = {
  'La Liga': 'PD',
  'Premier League': 'PL',
  'Serie A': 'SA',
  'Bundesliga': 'BL1',
  'Ligue 1': 'FL1',
  'UEFA Champions League': 'CL',
  'UEFA Europa League': 'EL',
};

export interface FootballMatch {
  id: number;
  utcDate: string;
  status: 'TIMED' | 'LIVE' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'POSTPONED' | 'CANCELLED' | 'SUSPENDED';
  stage: string;
  group?: string;
  lastUpdated: string;
  homeTeam: {
    id: number;
    name: string;
    shortName?: string;
    tla?: string;
    crest?: string;
  };
  awayTeam: {
    id: number;
    name: string;
    shortName?: string;
    tla?: string;
    crest?: string;
  };
  score: {
    winner?: string;
    duration: string;
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    extraTime?: { home: number | null; away: number | null };
    penalties?: { home: number | null; away: number | null };
  };
  odds?: { msg: string };
  referee?: Array<{ id: number; name: string; type: string }>;
}

export interface Team {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest: string;
  address?: string;
  website?: string;
  founded?: number;
  clubColors?: string;
  venue?: string;
  lastUpdated: string;
}

export interface Standing {
  position: number;
  team: Team;
  playedGames: number;
  form?: string;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface League {
  id: number;
  name: string;
  code: string;
  type: string;
  emblem: string;
  currentSeason: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday?: number;
    winner?: {
      id: number;
      name: string;
      shortName: string;
      tla: string;
      crest: string;
    };
  };
}

interface ApiResponse<T> {
  filters?: Record<string, any>;
  resultSet?: Record<string, any>;
  competition?: League;
  season?: Record<string, any>;
  matches?: T[];
  teams?: T[];
  standings?: Array<{ stage?: string; group?: string; table: T[] }>;
}

async function fetchFromFootballData<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  if (!API_KEY) {
    throw new Error('FOOTBALL_DATA_API_KEY not configured');
  }

  const url = new URL(`${FOOTBALL_DATA_API}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      'X-Auth-Token': API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Football-Data API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function getMatches(leagueName: string, status?: string): Promise<FootballMatch[]> {
  const code = LEAGUE_CODES[leagueName] || 'PD';
  const params: Record<string, string> = { limit: '100' };
  
  if (status) {
    params.status = status; // 'TIMED', 'LIVE', 'FINISHED'
  }

  const data = await fetchFromFootballData<ApiResponse<FootballMatch>>(`/competitions/${code}/matches`, params);
  return data.matches || [];
}

export async function getLiveMatches(): Promise<FootballMatch[]> {
  const data = await fetchFromFootballData<ApiResponse<FootballMatch>>('/matches', { status: 'LIVE' });
  return data.matches || [];
}

export async function getUpcomingMatches(leagueName: string, days: number = 7): Promise<FootballMatch[]> {
  const code = LEAGUE_CODES[leagueName] || 'PD';
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const data = await fetchFromFootballData<ApiResponse<FootballMatch>>(`/competitions/${code}/matches`, {
    status: 'SCHEDULED',
    dateFrom: now.toISOString().split('T')[0],
    dateTo: future.toISOString().split('T')[0],
  });

  return data.matches || [];
}

export async function getStandings(leagueName: string): Promise<Standing[]> {
  const code = LEAGUE_CODES[leagueName] || 'PD';
  const data = await fetchFromFootballData<ApiResponse<Standing>>(`/competitions/${code}/standings`);
  
  if (data.standings && data.standings.length > 0) {
    return data.standings[0].table || [];
  }
  return [];
}

export async function getTeamInfo(teamId: number): Promise<Team> {
  const data = await fetchFromFootballData<Team>(`/teams/${teamId}`);
  return data;
}

export async function getLeagueInfo(leagueName: string): Promise<League> {
  const code = LEAGUE_CODES[leagueName] || 'PD';
  const data = await fetchFromFootballData<League>(`/competitions/${code}`);
  return data;
}

export async function getTeamsInLeague(leagueName: string): Promise<Team[]> {
  const code = LEAGUE_CODES[leagueName] || 'PD';
  const data = await fetchFromFootballData<ApiResponse<Team>>(`/competitions/${code}/teams`);
  return data.teams || [];
}

export function getLeagueCodes(): Record<string, string> {
  return LEAGUE_CODES;
}

export function mapMatchStatus(status: string): string {
  const statusMap: Record<string, string> = {
    TIMED: 'Próximamente',
    SCHEDULED: 'Próximamente',
    LIVE: 'En directo',
    IN_PLAY: 'En juego',
    PAUSED: 'Pausado',
    FINISHED: 'Finalizado',
    POSTPONED: 'Aplazado',
    CANCELLED: 'Cancelado',
    SUSPENDED: 'Suspendido',
  };
  return statusMap[status] || status;
}
