import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './layouts/Layout';
import DailyNotesPage from './pages/DailyNotesPage';
import RegisterPage from './pages/auth/RegisterPage';
import LoginPage from './pages/auth/LoginPage';
import About from './pages/About';
import Project from './pages/Project';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/daily-notes" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/daily-notes" element={
          <ProtectedRoute>
            <DailyNotesPage />
          </ProtectedRoute>
        } />
        <Route path="/about" element={<About />} />
        <Route path="/project" element={<Project />} />
      </Routes>
    </Layout>
  );
}
