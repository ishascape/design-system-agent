export function Work({ open }: { open: boolean }) {
  return (
    <article className={`card ${open ? 'is-open' : ''}`}>
      <span className="button">Read</span>
      <button type="button" className="button">More</button>
    </article>
  );
}
