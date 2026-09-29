export default function FixtureRoomLoading() {
  return (
    <div className="nr nr-loading" role="status" aria-live="polite">
      <span className="nr-spinner" aria-hidden="true" />
      <span>Loading the Fixture Room…</span>
    </div>
  );
}
