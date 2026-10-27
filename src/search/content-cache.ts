// LRU cache for file contents, invalidated by mtime and size. Bounded by entry count and by total bytes.
interface EntradaCache<T> {
  mtime: number;
  tamanho: number;
  valor: T;
  bytes: number;
}

export class ContentCache<T> {
  private readonly entradas = new Map<string, EntradaCache<T>>();
  private bytesTotal = 0;

  constructor(
    private readonly maxEntradas = 200,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  get(chave: string, mtime: number, tamanho: number): T | undefined {
    const entrada = this.entradas.get(chave);
    if (!entrada) return undefined;
    if (entrada.mtime !== mtime || entrada.tamanho !== tamanho) {
      this.remover(chave);
      return undefined;
    }
    // Move to the end: most recently used.
    this.entradas.delete(chave);
    this.entradas.set(chave, entrada);
    return entrada.valor;
  }

  set(chave: string, mtime: number, tamanho: number, valor: T, bytes = tamanho): void {
    this.remover(chave);
    // An entry that alone exceeds the byte limit is never kept.
    if (bytes > this.maxBytes) return;
    this.entradas.set(chave, { mtime, tamanho, valor, bytes });
    this.bytesTotal += bytes;
    while (this.entradas.size > this.maxEntradas || this.bytesTotal > this.maxBytes) {
      const menosRecente = this.entradas.keys().next().value;
      if (menosRecente === undefined) break;
      this.remover(menosRecente);
    }
  }

  clear(): void {
    this.entradas.clear();
    this.bytesTotal = 0;
  }

  get size(): number {
    return this.entradas.size;
  }

  get bytes(): number {
    return this.bytesTotal;
  }

  private remover(chave: string): void {
    const entrada = this.entradas.get(chave);
    if (!entrada) return;
    this.bytesTotal -= entrada.bytes;
    this.entradas.delete(chave);
  }
}
