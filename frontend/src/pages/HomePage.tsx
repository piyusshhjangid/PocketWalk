interface Props {
  onStart: () => void;
}

export function HomePage({ onStart }: Props) {
  return (
    <main className="screen screen--home">
      <div className="home__copy">
        <h1 className="display" tabIndex={-1} data-screen-heading>
          PocketWalk
        </h1>
        <p className="tagline">A little less screen. A little more outside.</p>
        <p className="lead">Choose a walk and we&rsquo;ll plan it. Read it for a moment, then put your phone away.</p>
        <button type="button" className="btn btn--primary btn--block" onClick={onStart}>
          Start a walk
        </button>
      </div>
      <svg className="home__path" viewBox="0 0 320 220" aria-hidden="true" focusable="false">
        <path className="home__trail" d="M12 196 C70 196 74 128 130 134 S196 190 226 132 S272 40 308 28" />
        <circle className="home__dot" cx="308" cy="28" r="7" />
      </svg>
    </main>
  );
}
