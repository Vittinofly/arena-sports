/* ============================================================
   Arena Esporte: Pix "copia e cola" (padrão BR Code do Banco Central)
   Só aparece se o ADM ligar o Pix no painel. O padrão da arena é
   pagar no local; o Pix é opcional para quem quiser adiantar.
   ============================================================ */
(function () {
  'use strict';

  const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';

  function campo(id, valor) {
    const v = String(valor);
    return id + String(v.length).padStart(2, '0') + v;
  }
  function semAcento(t, max) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 .-]/g, '').toUpperCase().trim().slice(0, max);
  }
  function crc16(payload) {
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // { chave, nome, cidade, valor?, txid? } -> texto do Pix copia e cola
  function copiaECola(o) {
    const chave = String(o.chave || '').trim();
    if (!chave) return '';
    const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
    const txid = semAcento(o.txid || '***', 25).replace(/[^A-Z0-9*]/g, '') || '***';
    let p = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
    if (o.valor != null && Number(o.valor) > 0) p += campo('54', Number(o.valor).toFixed(2));
    p += campo('58', 'BR') + campo('59', semAcento(o.nome || 'ARENA ESPORTE', 25) || 'ARENA ESPORTE') +
      campo('60', semAcento(o.cidade || 'SAO LUIS DE MONTES BELOS', 15) || 'SAO LUIS') + campo('62', campo('05', txid)) + '6304';
    return p + crc16(p);
  }

  let promessaQr = null;
  function carregarQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!promessaQr) {
      promessaQr = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = QR_CDN;
        s.async = true;
        s.onload = () => ok(window.qrcode);
        s.onerror = falha;
        document.head.appendChild(s);
      });
    }
    return promessaQr;
  }
  // Devolve um <img> com o QR Code, ou null se a biblioteca não carregar
  async function imagemQr(texto) {
    try {
      const qrcode = await carregarQr();
      const qr = qrcode(0, 'M');
      qr.addData(texto);
      qr.make();
      const img = new Image();
      img.src = qr.createDataURL(6, 2);
      img.alt = 'QR Code do Pix da Arena Esporte';
      img.width = 200;
      img.height = 200;
      return img;
    } catch (e) { return null; }
  }

  window.ArenaPix = { copiaECola, imagemQr, crc16 };
})();
