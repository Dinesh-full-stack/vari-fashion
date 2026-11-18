/** Soft colour fields behind every page, so the glass has something bright to blur. Pure CSS, no images. */
export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <i className="b1" /><i className="b2" /><i className="b3" /><i className="b4" />
    </div>
  );
}
