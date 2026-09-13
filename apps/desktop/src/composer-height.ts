export function fitComposerTextarea(composer: HTMLTextAreaElement, maxHeight: number): void {
  const applyHeight = (nextHeight: number): void => {
    composer.style.height = `${nextHeight}px`;
    composer.style.overflowY = nextHeight >= maxHeight ? "auto" : "hidden";
  };

  if (composer.scrollHeight > composer.clientHeight + 1) {
    applyHeight(Math.min(composer.scrollHeight, maxHeight));
    return;
  }

  composer.style.height = "auto";
  applyHeight(Math.min(composer.scrollHeight, maxHeight));
}
