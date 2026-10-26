// LRU cache for file contents, invalidated by mtime and size.
interface EntradaCache<T> {
  mtime: number;
  tamanho: number;
  valor: T;
}

export class ContentCache<T> {
  private readonly entradas = new Map<string, EntradaCache<T>>();

  constructor(private readonly maxEntradas = 200) {}

  get(chave: string, mtime: number, tamanho: number): T | undefined {
    const entrada = this.entradas.get(chave);
    if (!entrada) return undefined;
    if (entrada.mtime !== mtime || entrada.tamanho !== tamanho) {
      this.entradas.delete(chave);
      return undefined;
    }
    // Move to the end: most recently used.
    this.entradas.delete(chave);
    this.entradas.set(chave, entrada);
    return entrada.valor;
  }

  set(chave: string, mtime: number, tamanho: number, valor: T): void {
    this.entradas.delete(chave);
    this.entradas.set(chave, { mtime, tamanho, valor });
    while (this.entradas.size > this.maxEntradas) {
      const menosRecente = this.entradas.keys().next().value;
      if (menosRecente === undefined) break;
      this.entradas.delete(menosRecente);
    }
  }

  clear(): void {
    this.entradas.clear();
  }

  get size(): number {
    return this.entradas.size;
  }
}
