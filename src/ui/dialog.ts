// A small in-app modal for confirmations and errors (avoids blocking native dialogs).

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export function choose(title: string, detail: string, buttons: DialogButton[]): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog';
    overlay.innerHTML = `<div class="dialog-card" role="alertdialog" aria-modal="true">
      <h2></h2><p></p><div class="dialog-buttons"></div></div>`;
    overlay.querySelector('h2')!.textContent = title;
    overlay.querySelector('p')!.textContent = detail;
    const row = overlay.querySelector('.dialog-buttons')!;

    const close = (value: string) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close('cancel');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close((buttons.find((b) => b.primary) ?? buttons[buttons.length - 1]).value);
      }
    };

    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.className = 'text' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.addEventListener('click', () => close(b.value));
      row.append(el);
    }
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close('cancel');
    });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
  });
}

export async function alertError(title: string, detail: string): Promise<void> {
  await choose(title, detail, [{ label: 'OK', value: 'ok', primary: true }]);
}
