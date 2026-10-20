import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';

// Parser/cache fixture only; real JPEG decoding is covered by browser PDF replay.
function jpegTail(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(100);
  bytes.set([255, 216, 255, 224, 0, 2, 255, 192, 0, 17, 8, 0, 1, 0, 1, 3]);
  bytes[90] = value; bytes[98] = 255; bytes[99] = 217;
  return bytes;
}

describe('PDF typed JPEG page aliases', () => {
  it('keeps different JPEG tails as distinct image objects in the actual PDF library', () => {
    const first = jpegTail(1); const second = jpegTail(2);
    expect(first.slice(0, first.length / 2)).toEqual(second.slice(0, second.length / 2));
    expect(first).not.toEqual(second);
    const pdf = new jsPDF({ compress: false });
    for (const [index, image] of [first, second].entries()) {
      if (index) pdf.addPage();
      pdf.addImage(image, 'JPEG', 16, 16, 178, 100, `page-${index + 1}`, 'FAST');
    }
    const output = pdf.output();
    expect(output.match(/\/Subtype \/Image\b/g)).toHaveLength(2);
    expect(output).toContain(String.fromCharCode(...first));
    expect(output).toContain(String.fromCharCode(...second));
  });
});
