export default function FixtureRoomLoading() {
  return (
    <div className="fxr fxr-loading" role="status" aria-live="polite">
      <span className="fxr-spinner" aria-hidden="true" />
      <span>Loading the Fixture Room…</span>
    </div>
  );
}
