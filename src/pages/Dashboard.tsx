import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useQuizStats } from "../hooks/useQuizStats";

const VERIFY_TEXT = {
  verified: "Verified student",
  pending: "Verification pending",
  rejected: "Verification rejected",
  reupload_required: "Please upload your ID again",
} as const;

export default function Dashboard() {
  const { profile, subscription, hasPremiumAccess } = useAuth();
  const { stats } = useQuizStats();
  if (!profile) return null;

  const daysLeft = subscription?.endsAt
    ? Math.max(0, Math.ceil((subscription.endsAt.toMillis() - Date.now()) / 86_400_000))
    : 0;

  let planTitle = "No active plan";
  let planBody = "Subscribe to unlock learning materials, quizzes and the AI study guide.";
  if (subscription?.status === "trial" && hasPremiumAccess) {
    planTitle = `Free trial: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
    planBody = "Everything is unlocked during your trial.";
  } else if (subscription?.status === "active" && hasPremiumAccess) {
    planTitle = `Subscribed: ${daysLeft} days left`;
    planBody = "Your monthly plan is active.";
  } else if (subscription?.status === "expired") {
    planTitle = "Your plan has expired";
  } else if (subscription?.trialStatus === "already_used") {
    planTitle = "Your free trial has already been used";
  } else if (profile.verificationStatus !== "verified") {
    planTitle = "Verify your student ID to start your free month";
    planBody = "Your details didn't match the NDC list yet. An admin will review them.";
  }

  return (
    <>
      <header className="page-head">
        <h1>Hello, {profile.fullName.split(" ")[0]}</h1>
        <span className={`badge ${profile.verificationStatus}`}>{VERIFY_TEXT[profile.verificationStatus]}</span>
      </header>

      <section className="plan-card">
        <div>
          <h2>{planTitle}</h2>
          <p>{planBody}</p>
        </div>
        {!hasPremiumAccess && (
          <Link className="btn" to="/subscription">
            See subscription
          </Link>
        )}
      </section>

      {stats && (
        <section className="grid" style={{ marginBottom: "1.25rem" }} aria-label="Your progress">
          <div className="tile"><span>Quizzes taken</span><strong className="stat">{stats.total}</strong></div>
          <div className="tile"><span>Average score</span><strong className="stat">{stats.avg}%</strong></div>
          <div className="tile"><span>Day streak</span><strong className="stat">{stats.streak}</strong></div>
          {stats.weak.length > 0 && <div className="tile"><span>Revise</span><strong>{stats.weak.map((w) => w.k).join(", ")}</strong></div>}
        </section>
      )}

      <section className="grid">
        <Link className="tile" to="/learn"><strong>Class materials</strong><span>Notes, formulas, homework</span></Link>
        <Link className="tile" to="/quiz"><strong>Quizzes</strong><span>Weekly model quiz and practice</span></Link>
        <Link className="tile" to="/ai"><strong>AI study assistant</strong><span>Ask about today's class</span></Link>
        <Link className="tile" to="/homework"><strong>Homework help</strong><span>Hints and step-by-step help</span></Link>
        <Link className="tile" to="/chat"><strong>Chat</strong><span>Class groups and classmates</span></Link>
        <Link className="tile" to="/insights"><strong>My insights</strong><span>Progress, weak topics, study tips</span></Link>
        <Link className="tile" to="/feed"><strong>Feed</strong><span>Announcements and posts</span></Link>
      </section>
    </>
  );
}
