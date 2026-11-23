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

export function diffPng(referenceBytes, actualBytes, { maskRows = 0 } = {}) {
  const reference = PNG.sync.read(referenceBytes);
  const actual = PNG.sync.read(actualBytes);
  const width = Math.max(reference.width, actual.width);
  const height = Math.max(reference.height, actual.height);
  const diff = new PNG({ width, height });
  const sharedWidth = Math.min(reference.width, actual.width);
  const sharedHeight = Math.max(0, Math.min(reference.height, actual.height) - maskRows);
  let mismatchPixels = 0;
  if (sharedHeight > 0) {
    // Crop before pixelmatch so neither its denominator nor AA detection sees the mask.
    const overlap = () => new PNG({ width: sharedWidth, height: sharedHeight });
    const [left, right, output] = [overlap(), overlap(), overlap()];
    copyRows(reference, left, sharedWidth, sharedHeight, maskRows, 0);
    copyRows(actual, right, sharedWidth, sharedHeight, maskRows, 0);
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
    for (let x = Math.min(leftWidth, rightWidth); x < Math.max(leftWidth, rightWidth); x++) {
      diff.data.writeUInt32BE(0xff0000ff, (y * width + x) * 4);
      mismatchPixels++;
    }
  }
  const comparedPixels =
    reference.width * Math.max(0, reference.height - maskRows) +
    actual.width * Math.max(0, actual.height - maskRows) -
    sharedWidth * sharedHeight;
  return {
    png: PNG.sync.write(diff),
    mismatchPixels,
    comparedPixels,
    percent: comparedPixels ? (100 * mismatchPixels) / comparedPixels : 0,
  };
}
