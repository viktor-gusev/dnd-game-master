export const DEFAULT_MAX_RECORDS = 50;
export const MIN_MAX_RECORDS = 1;
export const MAX_MAX_RECORDS = 200;

export function normalizeMaxRecords(value) {
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(numeric)) {
    return DEFAULT_MAX_RECORDS;
  }
  if ((numeric < MIN_MAX_RECORDS) || (numeric > MAX_MAX_RECORDS)) {
    return DEFAULT_MAX_RECORDS;
  }
  return numeric;
}

export class ErrorRecordBuffer {
  #maxRecords;
  #records = [];

  constructor({ maxRecords = DEFAULT_MAX_RECORDS } = {}) {
    this.#maxRecords = normalizeMaxRecords(maxRecords);
  }

  add(record) {
    this.#records.push({ ...record });
    this.#trim();
    return this.size;
  }

  clear() {
    this.#records = [];
  }

  get maxRecords() {
    return this.#maxRecords;
  }

  get size() {
    return this.#records.length;
  }

  getRecords() {
    return this.#records.map((record) => ({ ...record }));
  }

  setMaxRecords(value) {
    this.#maxRecords = normalizeMaxRecords(value);
    this.#trim();
    return this.#maxRecords;
  }

  #trim() {
    if (this.#records.length <= this.#maxRecords) return;
    this.#records.splice(0, this.#records.length - this.#maxRecords);
  }
}
