import { Buffer } from 'node:buffer';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const PIXELMATCH_THRESHOLD = 0.1;
export const maskRowsFor = (frame) => (frame === 'TopBar' || frame === 'WorkNav' ? 0 : 56);

function copyRows(image, target, width, rows, sourceY, targetY) {
  for (let y = 0; y < rows; y++) {
    const offset = (sourceY + y) * image.width * 4;
    image.data.copy(target.data, (targetY + y) * target.width * 4, offset, offset + width * 4);
  }
}

export function alignBelowTopBars(
  referenceBytes,
  actualBytes,
  referenceBottom,
  actualBottom,
  viewportHeight,
) {
  // Keep the same minimum content viewport in both images. Only account for
  // blank viewport space lost to the taller bar; never pad away page overflow.
  const minHeight = viewportHeight - Math.min(referenceBottom, actualBottom);
  return [
    [referenceBytes, referenceBottom],
    [actualBytes, actualBottom],
  ].map(([bytes, bottom]) => {
    const image = PNG.sync.read(bytes);
    if (!Number.isInteger(bottom) || bottom <= 0 || bottom >= image.height) {
      throw new Error(`Invalid TopBar bottom: ${bottom}`);
    }
    const rows = image.height - bottom;
    const cropped = new PNG({ width: image.width, height: Math.max(rows, minHeight) });
    copyRows(image, cropped, image.width, rows, bottom, 0);
    cropped.data.fill(Buffer.from([0xf6, 0xf7, 0xf9, 0xff]), rows * image.width * 4);
    return PNG.sync.write(cropped);
  });
}

export function diffPng(referenceBytes, actualBytes, { maskRows = 0, maskRects = [] } = {}) {
  const reference = PNG.sync.read(referenceBytes);
  const actual = PNG.sync.read(actualBytes);
  const width = Math.max(reference.width, actual.width);
  const height = Math.max(reference.height, actual.height);
  const diff = new PNG({ width, height });
  const sharedWidth = Math.min(reference.width, actual.width);
  const sharedHeight = Math.max(0, Math.min(reference.height, actual.height) - maskRows);
  const masked = new Uint8Array(width * height);
  for (const { left, right, top, bottom } of maskRects) {
    for (
      let y = Math.max(maskRows, Math.floor(top));
      y < Math.min(height, Math.ceil(bottom));
      y++
    ) {
      masked.fill(
        1,
        y * width + Math.max(0, Math.floor(left)),
        y * width + Math.min(width, Math.ceil(right)),
      );
    }
  }
  let mismatchPixels = 0;
  let comparedPixels = 0;
  if (sharedHeight > 0) {
    // Crop before pixelmatch so neither its denominator nor AA detection sees the mask.
    const overlap = () => new PNG({ width: sharedWidth, height: sharedHeight });
    const [left, right, output] = [overlap(), overlap(), overlap()];
    copyRows(reference, left, sharedWidth, sharedHeight, maskRows, 0);
    copyRows(actual, right, sharedWidth, sharedHeight, maskRows, 0);
    for (let y = 0; y < sharedHeight; y++) {
      for (let x = 0; x < sharedWidth; x++) {
        if (!masked[(y + maskRows) * width + x]) continue;
        const offset = (y * sharedWidth + x) * 4;
        left.data.copy(right.data, offset, offset, offset + 4);
      }
    }
    mismatchPixels = pixelmatch(left.data, right.data, output.data, sharedWidth, sharedHeight, {
      threshold: PIXELMATCH_THRESHOLD,
    });
    copyRows(output, diff, sharedWidth, sharedHeight, 0, maskRows);
  }

  // Count missing/extra pixels as differences independently of their color. The
  // denominator is the union of both unmasked images (not the padded rectangle).
  for (let y = maskRows; y < height; y++) {
    const leftWidth = y < reference.height ? reference.width : 0;
    const rightWidth = y < actual.height ? actual.width : 0;
    for (let x = 0; x < Math.max(leftWidth, rightWidth); x++) {
      const offset = y * width + x;
      if (masked[offset]) {
        diff.data.writeUInt32BE(0, offset * 4);
        continue;
      }
      comparedPixels++;
      if (x >= Math.min(leftWidth, rightWidth)) {
        diff.data.writeUInt32BE(0xff0000ff, offset * 4);
        mismatchPixels++;
      }
    }
  }
  return {
    png: PNG.sync.write(diff),
    mismatchPixels,
    comparedPixels,
    percent: comparedPixels ? (100 * mismatchPixels) / comparedPixels : 0,
  };
}
