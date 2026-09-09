import React from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RaceProvider } from './RaceContext';
import { OverviewPage } from './pages/OverviewPage';
import { DecisionPage } from './pages/DecisionPage';
import { CarPage } from './pages/CarPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { SandboxPage } from './pages/SandboxPage';

// Hash routing: the console is served as a static bundle with no server-side
// rewrite rules, so hash routes survive a refresh on any page.
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'decision', element: <DecisionPage /> },
      { path: 'car', element: <CarPage /> },
      { path: 'analysis', element: <AnalysisPage /> },
      { path: 'sandbox', element: <SandboxPage /> },
    ],
  },
]);

export default function App() {
  return (
    <RaceProvider>
      <RouterProvider router={router} />
    </RaceProvider>
  );
}
