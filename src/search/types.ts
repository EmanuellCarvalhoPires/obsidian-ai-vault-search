// Types for AI Vault Search engine

export interface SearchMatch {
  caminho: string;
  nome: string;
  tags?: string[];
  up?: string[];
  modificada?: string;
  pontos?: number;
  linha?: number;
  trecho?: string;
  secao_titulo?: string;
  secao_linha?: number;
  secao_trecho?: string;
  skill?: boolean;
  efeito?: string;
  tipo?: "nota" | "pasta" | "arquivo" | "codigo" | "texto" | "tabela" | "documento";
  total_arquivos?: number;
  total_subpastas?: number;
  tamanho_bytes?: number;
  extensao?: string;
  conteudo?: string;
  cabecalhos_disponiveis?: { nivel: number; titulo: string; linha: number }[];
  aba?: string;
  celula?: string;
  coluna?: string;
  coluna_nome?: string;
  valor?: string;
  pagina?: number;
  paragrafo?: number;
  simbolo_envolvente?: string;
  linha_inicio?: number;
  linha_fim?: number;
  simbolos_disponiveis?: { nome: string; tipo: string; linha: number }[];
}

export interface SearchQueryParams {
  acao?: "buscar" | "listar_pastas" | "listar_arquivos" | "obter_secao" | "status" | "buscar_rapida";
  query?: string;
  padrao?: string;
  titulo?: string;
  filtro?: string;
  pasta?: string;
  extensao?: string;
  extensoes?: string[];
  recursivo?: boolean;
  cabecalho?: string;
  termos?: string[];
  tag?: string;
  filhas?: string;
  arvore?: string;
  profundidade?: number;
  backlinks?: string;
  links?: string;
  prop?: string;
  nota?: string;
  recentes?: number;
  limite?: number;
  modo?: "hibrido" | "exato" | "semantico";
  secao?: boolean;
  compacto?: boolean;
  linha_inicio?: number;
  linha_fim?: number;
}

export interface SearchResultPayload {
  consulta: Record<string, unknown>;
  total: number;
  resultados: SearchMatch[];
  dicas?: string[];
  tempo_ms?: number;
  estatisticas?: Record<string, unknown>;
}
