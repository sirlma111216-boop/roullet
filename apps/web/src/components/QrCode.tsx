/**
 * 참여 QR.
 *
 * ★ QR 에는 **학생용 입장 주소만** 넣는다. 교사 토큰은 절대 들어가지 않는다 —
 *   교실 앞 화면에 띄우는 그림이라, 사진 한 장으로 교사 권한이 새어 나가면 안 된다.
 */

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export interface QrCodeProps {
  /** 학생 입장 주소 */
  url: string;
  size?: number;
  label?: string;
}

export function QrCode({ url, size = 336, label }: QrCodeProps): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let alive = true;
    QRCode.toCanvas(canvas, url, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1020ff', light: '#ffffffff' },
    })
      .then(() => {
        if (alive) setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'QR 을 만들지 못했습니다.');
      });
    return () => {
      alive = false;
    };
  }, [url, size]);

  if (error) {
    return (
      <div className="notice notice--bad">
        <span>QR 을 만들지 못했습니다. 주소를 직접 알려 주세요: {url}</span>
      </div>
    );
  }

  return (
    <div className="joinbox__qr">
      <canvas ref={ref} aria-label={label ?? `참여 QR 코드. 주소 ${url}`} role="img" />
    </div>
  );
}
