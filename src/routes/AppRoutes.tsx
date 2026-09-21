import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Loader } from "../components/Loader";
import { StudentLayout } from "../layouts/StudentLayout";
import { RequireAuth, RequirePremium, RequireRole } from "./guards";

const Login = lazy(() => import("../pages/Login"));
const Register = lazy(() => import("../pages/Register"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Subscription = lazy(() => import("../pages/Subscription"));
const Feed = lazy(() => import("../pages/Feed"));
const Profile = lazy(() => import("../pages/Profile"));
const Learn = lazy(() => import("../pages/Learn"));
const MaterialView = lazy(() => import("../pages/MaterialView"));
const AdminLayout = lazy(() => import("../admin/AdminLayout"));
const AdminOverview = lazy(() => import("../admin/Overview"));
const AdminStudents = lazy(() => import("../admin/Students"));
const AdminVerification = lazy(() => import("../admin/Verification"));
const AdminMaterials = lazy(() => import("../admin/Materials"));
const AdminMaterialEditor = lazy(() => import("../admin/MaterialEditor"));
const AdminSubjects = lazy(() => import("../admin/Subjects"));
const AdminRoster = lazy(() => import("../admin/Roster"));
const AdminSettings = lazy(() => import("../admin/Settings"));
const AdminAudit = lazy(() => import("../admin/AuditLog"));
const QuizList = lazy(() => import("../pages/QuizList"));
const QuizDetail = lazy(() => import("../pages/QuizDetail"));
const Results = lazy(() => import("../pages/Results"));
const ResultView = lazy(() => import("../pages/ResultView"));
const AdminQuestions = lazy(() => import("../admin/QuestionBank"));
const AdminQuestionEditor = lazy(() => import("../admin/QuestionEditor"));
const AdminQuizzes = lazy(() => import("../admin/Quizzes"));
const AdminQuizEditor = lazy(() => import("../admin/QuizEditor"));
const AdminAiGenerator = lazy(() => import("../admin/AiGenerator"));
const AdminAiSettings = lazy(() => import("../admin/AiSettings"));
const Notifications = lazy(() => import("../pages/Notifications"));
const AdminNotify = lazy(() => import("../admin/Notify"));
const PaymentSuccess = lazy(() => import("../pages/PaymentSuccess"));
const PaymentFailure = lazy(() => import("../pages/PaymentFailure"));
const AdminPayments = lazy(() => import("../admin/Payments"));
const StudyAssistant = lazy(() => import("../pages/StudyAssistant"));
const Homework = lazy(() => import("../pages/Homework"));
const Chat = lazy(() => import("../pages/Chat"));
const AdminReports = lazy(() => import("../admin/Reports"));
const AdminChatGroups = lazy(() => import("../admin/ChatGroups"));
const Insights = lazy(() => import("../pages/Insights"));
const StudentProfile = lazy(() => import("../pages/StudentProfile"));
const AdminAnalytics = lazy(() => import("../admin/Analytics"));
const Legal = lazy(() => import("../pages/Legal"));

export function AppRoutes() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/terms" element={<Legal kind="terms" />} />

        <Route element={<RequireAuth />}>
          <Route element={<StudentLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/failure" element={<PaymentFailure />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/results" element={<Results />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/students/:uid" element={<StudentProfile />} />
            <Route path="/results/:id" element={<ResultView />} />

            {/* Premium-gated: trial or active subscription required */}
            <Route element={<RequirePremium />}>
              <Route path="/feed" element={<Feed />} />
              <Route path="/learn" element={<Learn />} />
              <Route path="/learn/:id" element={<MaterialView />} />
              <Route path="/quiz" element={<QuizList />} />
              <Route path="/quiz/:id" element={<QuizDetail />} />
              <Route path="/ai" element={<StudyAssistant />} />
              <Route path="/homework" element={<Homework />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/chat/:id" element={<Chat />} />
            </Route>

            <Route element={<RequireRole roles={["admin", "superadmin"]} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminOverview />} />
                <Route path="analytics" element={<AdminAnalytics />} />
                <Route path="students" element={<AdminStudents />} />
                <Route path="verification" element={<AdminVerification />} />
                <Route path="materials" element={<AdminMaterials />} />
                <Route path="materials/:id" element={<AdminMaterialEditor />} />
                <Route path="questions" element={<AdminQuestions />} />
                <Route path="questions/:id" element={<AdminQuestionEditor />} />
                <Route path="quizzes" element={<AdminQuizzes />} />
                <Route path="quizzes/:id" element={<AdminQuizEditor />} />
                <Route path="ai-generate" element={<AdminAiGenerator />} />
                <Route path="ai" element={<AdminAiSettings />} />
                <Route path="notify" element={<AdminNotify />} />
                <Route path="payments" element={<AdminPayments />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="chat" element={<AdminChatGroups />} />
                <Route path="subjects" element={<AdminSubjects />} />
                <Route path="roster" element={<AdminRoster />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="audit" element={<AdminAudit />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
