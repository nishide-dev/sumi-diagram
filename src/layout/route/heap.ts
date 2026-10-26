/**
 * A binary min-heap of (key, value) number pairs for Dijkstra. Ties on the
 * key are broken by the smaller value, so the pop order (and the search) is
 * fully determined by the inputs.
 */
export class PairHeap {
  readonly #keys: number[] = [];
  readonly #values: number[] = [];

  get size(): number {
    return this.#keys.length;
  }

  clear(): void {
    this.#keys.length = 0;
    this.#values.length = 0;
  }

  push(key: number, value: number): void {
    const keys = this.#keys;
    const values = this.#values;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pk = keys[parent] as number;
      const pv = values[parent] as number;
      if (pk < key || (pk === key && pv <= value)) break;
      keys[i] = pk;
      values[i] = pv;
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  /** Removes the smallest pair; the heap must not be empty. Returns its key and value. */
  pop(): [number, number] {
    const keys = this.#keys;
    const values = this.#values;
    const top: [number, number] = [keys[0] as number, values[0] as number];
    const lastKey = keys.pop() as number;
    const lastValue = values.pop() as number;
    const n = keys.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      let child = left;
      if (right < n) {
        const lk = keys[left] as number;
        const rk = keys[right] as number;
        if (rk < lk || (rk === lk && (values[right] as number) < (values[left] as number))) {
          child = right;
        }
      }
      const ck = keys[child] as number;
      const cv = values[child] as number;
      if (lastKey < ck || (lastKey === ck && lastValue <= cv)) break;
      keys[i] = ck;
      values[i] = cv;
      i = child;
    }
    keys[i] = lastKey;
    values[i] = lastValue;
    return top;
  }
}
