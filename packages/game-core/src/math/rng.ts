/**
 * 시드 난수.
 *
 * 경기에 쓰이는 무작위는 **전부** 여기를 거친다. Math.random() 을 직접 부르지 않는다.
 * 같은 시드 + 같은 호출 순서 = 같은 값이므로, 검사에서 경기를 되돌려 볼 수 있다.
 *
 * 주의: 시드가 같다고 해서 **다른 기기·다른 브라우저에서 경기 결과까지 같다고 보장하지 않는다.**
 * 부동소수점 연산 순서는 같지만 엔진·플랫폼 차이를 우리가 통제하지 못한다.
 * 그래서 실제 결과는 신뢰된 호스트 하나가 계산해 서버로 보낸다.
 */

/** 문자열 시드를 32비트 정수 네 개로 흩뜨린다 (cyrb128) */
function seedToInts(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32 — 빠르고 주기가 충분히 길다 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    const [a, b, c, d] = seedToInts(seed);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // 초기 상태의 치우침을 털어낸다
    for (let i = 0; i < 12; i++) this.next();
  }

  /** [0, 1) */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** [lo, hi) */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** [0, n) 정수 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** 제자리에서 섞는다 (Fisher–Yates) */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /** 새 배열을 섞어서 돌려준다 */
  shuffled<T>(items: readonly T[]): T[] {
    return this.shuffle([...items]);
  }
}

/**
 * 서버가 라운드마다 새로 만드는 시드.
 * 암호학적 난수를 쓴다 — 학생이 다음 배치를 미리 계산하지 못하게 하려는 것이다.
 */
export function createSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
