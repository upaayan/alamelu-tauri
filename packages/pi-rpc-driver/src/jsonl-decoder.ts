import { StringDecoder } from "node:string_decoder";

export class JsonlDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  push(chunk: string | Buffer): string[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const records: string[] = [];

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let record = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (record.endsWith("\r")) record = record.slice(0, -1);
      if (record.length > 0) records.push(record);
    }

    return records;
  }

  flush(): string[] {
    this.buffer += this.decoder.end();
    if (this.buffer.length === 0) return [];
    const record = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
    this.buffer = "";
    return record.length > 0 ? [record] : [];
  }
}
