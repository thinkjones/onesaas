import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import UploadDrop from './UploadDrop.tsx';

function imageFile(): File {
  return new File(['fake-image-bytes'], 'mug.jpg', { type: 'image/jpeg' });
}

describe('UploadDrop', () => {
  test('shows the prompt text', () => {
    render(<UploadDrop prompt="Drop a photo here" onUpload={() => {}} />);
    expect(screen.getByText('Drop a photo here')).toBeDefined();
  });

  test('accepts a dropped image and calls the upload mutation', () => {
    const onUpload = vi.fn();
    render(<UploadDrop prompt="Drop a photo here" onUpload={onUpload} />);
    const file = imageFile();
    fireEvent.drop(screen.getByText('Drop a photo here'), {
      dataTransfer: { files: [file] },
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  test('a drop with no files calls nothing', () => {
    const onUpload = vi.fn();
    render(<UploadDrop prompt="Drop a photo here" onUpload={onUpload} />);
    fireEvent.drop(screen.getByText('Drop a photo here'), {
      dataTransfer: { files: [] },
    });
    expect(onUpload).not.toHaveBeenCalled();
  });

  test('choosing a file via the picker calls the upload mutation', () => {
    const onUpload = vi.fn();
    render(<UploadDrop prompt="Drop a photo here" onUpload={onUpload} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = imageFile();
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith(file);
  });
});
