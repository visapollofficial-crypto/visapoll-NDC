import { Link } from "react-router-dom";

/** Placeholder text. Have NDC and a lawyer review before launch. */
export default function Legal({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <article className="legal">
      <Link to="/register">Back</Link>
      {kind === "privacy" ? (
        <>
          <h1>Privacy Policy (draft)</h1>
          <p>We collect: name, student ID, department, session, section, email, phone and, if you choose, a photo or ID card image for verification.</p>
          <p>We use it to verify you are an NDC student, run quizzes and show your own progress. Your email, phone and ID images are never shown to other students.</p>
          <p>ID card images are used only for verification and deleted after review. We do not store face templates.</p>
          <p>To request deletion of your data, contact the platform admin. Retention periods are set by the institution.</p>
          <p>AI features can be wrong and are not official teacher instruction.</p>
        </>
      ) : (
        <>
          <h1>Terms (draft)</h1>
          <p>Use the platform for learning. Do not share accounts, cheat in quizzes, or post abusive content. Accounts may be suspended for abuse.</p>
          <p>The free trial is limited to one per verified student. Subscriptions are billed monthly in BDT.</p>
        </>
      )}
    </article>
  );
}
