const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function safeFilePart(s = '') {
  return String(s).trim().normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 60) || 'student';
}

// 5x7 bitmap font. We draw rectangles instead of SVG <text>, so the
// worksheet does NOT depend on any fonts installed on Netlify.
const FONT = {
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],
  'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01111','10000','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['11111','00100','00100','00100','00100','00100','11111'],
  'J':['00111','00010','00010','00010','10010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','11001','10101','10011','10001','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','11011','10001'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  '.':['00000','00000','00000','00000','00000','00110','00110'],
  '/':['00001','00010','00010','00100','01000','01000','10000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '_':['00000','00000','00000','00000','00000','00000','11111'],
  ':':['00000','00110','00110','00000','00110','00110','00000'],
  ' ':['00000','00000','00000','00000','00000','00000','00000']
};

function bitmapTextSvg(text, x, y, opts = {}) {
  const upper = String(text || '').toUpperCase();
  const scale = opts.scale || 3;
  const gap = opts.gap ?? scale;
  const fill = opts.fill || '#111827';
  const opacity = opts.opacity ?? 1;
  const rotate = opts.rotate || 0;
  const anchor = opts.anchor || 'start';
  const maxWidth = opts.maxWidth || null;

  // Fit by lowering scale if needed.
  let sc = scale;
  const widthFor = s => upper.length ? upper.length * (5 * s + gap) - gap : 0;
  while (maxWidth && sc > 1 && widthFor(sc) > maxWidth) sc--;

  const charAdvance = 5 * sc + gap;
  const totalWidth = upper.length ? upper.length * charAdvance - gap : 0;
  let ox = 0;
  if (anchor === 'middle') ox = -totalWidth / 2;
  if (anchor === 'end') ox = -totalWidth;

  let rects = '';
  for (let i = 0; i < upper.length; i++) {
    const glyph = FONT[upper[i]] || FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          rects += `<rect x="${ox + i * charAdvance + col * sc}" y="${row * sc}" width="${sc}" height="${sc}" rx="${Math.max(0.5, sc * 0.18)}"/>`;
        }
      }
    }
  }
  return `<g transform="translate(${x} ${y}) rotate(${rotate})" fill="${fill}" fill-opacity="${opacity}">${rects}</g>`;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const requested = String(q.worksheet || '1');
    const worksheet = ['1','2','3'].includes(requested) ? requested : '1';
    const name = String(q.name || '').trim();
    const no = String(q.no || '').trim();
    const rawClass = String(q.class || '').trim();
    const isPreview = q.preview === '1';

    if (!name || !no || !rawClass) {
      res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send('Missing name, number, or class.');
    }

    const room = rawClass.replace(/\s+/g,'').replace(/^M\.?5\//i,'').replace(/^5\//,'') || rawClass;
    const classLabel = `M.5/${room}`;

    const cfg = worksheet === '3' ? {
      file: 'worksheet3.png',
      title: 'Present_Perfect_Simple_vs_Progressive',
      header: { name:[130,160,390], no:[650,160,90], room:[950,160,100] },
      positions: [[300,390],[900,470],[300,760],[900,900],[300,1210],[900,1450]],
      markWidth: 500
    } : worksheet === '2' ? {
      file: 'worksheet2.png',
      title: 'Present_Perfect_Simple_Exit_Worksheet',
      header: { name:[132,25,420], no:[635,25,95], room:[904,25,95] },
      positions: [[300,420],[885,430],[295,835],[880,845],[325,1210],[875,1450]],
      markWidth: 520
    } : {
      file: 'worksheet1.png',
      title: 'Present_Perfect_Progressive',
      header: { name:[122,31,375], no:[620,31,105], room:[918,31,120] },
      positions: [[310,430],[840,500],[260,870],[815,930],[320,1260],[835,1425]],
      markWidth: 500
    };

    const imagePath = path.join(__dirname, 'assets', cfg.file);
    const input = fs.readFileSync(imagePath);
    const meta = await sharp(input).metadata();
    const W = meta.width;
    const H = meta.height;

    const [nx,ny,nw] = cfg.header.name;
    const [ox,oy,ow] = cfg.header.no;
    const [cx,cy,cw] = cfg.header.room;
    const header = [
      bitmapTextSvg(name, nx, ny, { scale:3, gap:2, fill:'#111827', maxWidth:nw }),
      bitmapTextSvg(no,   ox, oy, { scale:3, gap:2, fill:'#111827', maxWidth:ow }),
      bitmapTextSvg(room, cx, cy, { scale:3, gap:2, fill:'#111827', maxWidth:cw })
    ].join('');

    const mark = `${name}  ${classLabel}  NO.${no}`;
    const marks = cfg.positions.map(([x,y]) => bitmapTextSvg(mark, x, y, {
      scale:3, gap:2, fill:'#7c3aed', opacity:0.20,
      rotate:-18, anchor:'middle', maxWidth:cfg.markWidth
    })).join('');

    const overlay = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${header}${marks}</svg>`;
    const png = await sharp(input).composite([{input:Buffer.from(overlay),top:0,left:0}]).png().toBuffer();

    const filename = `${cfg.title}_${safeFilePart(name)}_${safeFilePart(classLabel)}_No${safeFilePart(no)}.png`;
    res.status(200);
    res.setHeader('Content-Type', isPreview ? 'image/png' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${isPreview ? 'inline' : 'attachment'}; filename="${filename}"`);
    res.setHeader('Content-Length', String(png.length));
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(png);
  } catch (err) {
    console.error(err);
    res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('Could not create the worksheet PNG.');
  }
};
