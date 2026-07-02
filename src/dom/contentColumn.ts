// Tabby nests two `.content` elements under <app-root>; the deeper one (index 1)
// is the terminal/tab column. SidebarService locates the same element to fix its
// width; the status bar appends itself to the bottom of it.
export function findContentColumn(appRoot: Element): HTMLElement | null {
  const els = appRoot.querySelectorAll('.content');
  if (els.length > 1) {
    return els[1] as HTMLElement;
  }
  if (els.length === 1) {
    return els[0] as HTMLElement;
  }
  return null;
}
