/**
 * A binary min-heap of (key, value) pairs for the router's search: float
 * keys, non-negative integer values, in typed arrays that grow as needed
 * and are reused across searches. Ties on the key are broken by the smaller
 * value, so the pop order (and the search) is fully determined by the
 * inputs.
 */
export class PairHeap {
  #keys = new Float64Array(1024);
  #values = new Int32Array(1024);
  #size = 0;
  /** The key of the pair the last {@link pop} removed. */
  key = 0;

  get size(): number {
    return this.#size;
  }

  clear(): void {
    this.#size = 0;
  }

  push(key: number, value: number): void {
    if (this.#size === this.#keys.length) {
      const keys = new Float64Array(this.#size * 2);
      const values = new Int32Array(this.#size * 2);
      keys.set(this.#keys);
      values.set(this.#values);
      this.#keys = keys;
      this.#values = values;
    }
    const keys = this.#keys;
    const values = this.#values;
    let i = this.#size++;
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

  /** Removes the smallest pair; the heap must not be empty. Returns its value; its key is in `key`. */
  pop(): number {
    const keys = this.#keys;
    const values = this.#values;
    this.key = keys[0] as number;
    const top = values[0] as number;
    const n = --this.#size;
    if (n === 0) return top;
    const lastKey = keys[n] as number;
    const lastValue = values[n] as number;
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
