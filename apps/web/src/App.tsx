import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./context/AppContext.js";
import { Layout } from "./components/Layout.js";
import { OrgOverviewScreen } from "./screens/OrgOverview.js";
import { ProjectViewScreen } from "./screens/ProjectView.js";
import { RunTimelineScreen } from "./screens/RunTimeline.js";
import { FindingDetailScreen } from "./screens/FindingDetail.js";
import { ReviewQueueScreen } from "./screens/ReviewQueue.js";
import { PolicyViewScreen } from "./screens/PolicyView.js";
import { ReleaseReadinessScreen } from "./screens/ReleaseReadiness.js";
import { AuditExportScreen } from "./screens/AuditExport.js";
import { StyleguideScreen } from "./screens/Styleguide.js";

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<OrgOverviewScreen />} />
            <Route path="overview" element={<OrgOverviewScreen />} />
            <Route path="projects/:id" element={<ProjectViewScreen />} />
            <Route path="runs/:id" element={<RunTimelineScreen />} />
            <Route path="findings/:id" element={<FindingDetailScreen />} />
            <Route path="review-queue" element={<ReviewQueueScreen />} />
            <Route path="policy" element={<PolicyViewScreen />} />
            <Route path="release-readiness" element={<ReleaseReadinessScreen />} />
            <Route path="export" element={<AuditExportScreen />} />
            <Route path="styleguide" element={<StyleguideScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
