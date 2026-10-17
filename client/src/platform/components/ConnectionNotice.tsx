import { useConnectionNotice, type Notice } from '../lib/connectionNotice';

/** The notice's card: a spinner, the title and, under it, a second line when there is one. */
export function NoticeCard({ notice }: { notice: Notice }) {
  return (
    <div className="conn-notice__card" data-testid="connection-notice" data-status={notice.status}>
      <span className="spinner conn-notice__spinner" aria-hidden="true" />
      <span className="conn-notice__text">
        <strong className="conn-notice__title">{notice.title}</strong>
        {notice.detail && <span className="conn-notice__detail">{notice.detail}</span>}
      </span>
    </div>
  );
}

/**
 * The site's one connection notice, at the top of every screen: it comes up only once the
 * connection has been gone for a couple of seconds and goes the moment it is back. The live
 * region stays in the page so a screen reader hears it arrive.
 */
export function ConnectionNotice() {
  const notice = useConnectionNotice((s) => s.notice);
  return (
    <div className="conn-notice" role="status" aria-live="polite">
      {notice && <NoticeCard notice={notice} />}
    </div>
  );
}
