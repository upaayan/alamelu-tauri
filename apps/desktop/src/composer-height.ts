export function fitComposerTextarea(composer: HTMLTextAreaElement, maxHeight: number): void {
  if (composer.scrollHeight > composer.clientHeight + 1) {
    composer.style.height = `${Math.min(composer.scrollHeight, maxHeight)}px`;
    return;
  }

  composer.style.height = "auto";
  composer.style.height = `${Math.min(composer.scrollHeight, maxHeight)}px`;
}
