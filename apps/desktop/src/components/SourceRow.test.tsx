import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { hints, torrentSource } from '../test/coreState';
import { sourceFields, withEstimatedBitrate } from '../core/sourceFields';
import { SourceRow } from './SourceRow';

const release = torrentSource(
  {},
  {
    name: 'Torrentio\n4k DV',
    description:
      'Some.Film.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.REMUX-FraMeSToR\n👤 101 💾 54.33 GB ⚙️ TorrentGalaxy',
    hints: hints({
      filename: 'Some.Film.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.REMUX-FraMeSToR.mkv',
    }),
  },
);

function renderRow(onSelect = vi.fn()) {
  render(
    <SourceRow
      addonName="Torrentio"
      disabled={false}
      external={null}
      failed={false}
      fields={withEstimatedBitrate(sourceFields(release), '2h 22min')}
      onSelect={onSelect}
      playable
      selectable
      unavailable=""
    />,
  );
  return onSelect;
}

describe('source row', () => {
  it('shows the comparable fields on the row and the full text only behind Details', () => {
    renderRow();
    const row = screen.getByRole('button', { name: /2160p Remux/ });
    expect(row).toHaveTextContent('DV');
    expect(row).toHaveTextContent('DTS-HD MA 5.1');
    expect(row).toHaveTextContent('FraMeSToR');
    expect(row).toHaveTextContent('54.3 GB');
    expect(row).toHaveTextContent('~55 Mbps');
    // The release name is not repeated on the row; the movie title lives there.
    expect(row).not.toHaveTextContent('Some.Film');
    expect(screen.queryByText(/FraMeSToR\.mkv/)).not.toBeInTheDocument();
  });

  it('opens and closes details without playing, and keeps focus on the toggle', () => {
    const onSelect = renderRow();
    const toggle = screen.getByRole('button', { name: 'Details' });
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/FraMeSToR\.mkv/)).toBeInTheDocument();
    expect(
      screen.getByText('Estimated from the reported size and the title runtime.'),
    ).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/FraMeSToR\.mkv/)).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('plays only from the row itself', () => {
    const onSelect = renderRow();
    fireEvent.click(screen.getByRole('button', { name: /2160p Remux/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
