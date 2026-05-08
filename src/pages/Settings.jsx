import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun, ChevronRight, LogOut, User, Bell, Globe, Shield, FileText } from 'lucide-react';

export default function Settings() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(false);

  // Load saved theme
  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Toggle theme
  const toggleDarkMode = () => {
    const newDark = !darkMode;
    setDarkMode(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        ← Back
      </button>

      <h2 className="text-2xl font-bold text-foreground mb-8">Settings</h2>

      <div className="space-y-1">
        {/* Account Profile */}
        <button
          onClick={() => navigate('/profile')}
          className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-muted-foreground" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Account Profile</p>
              <p className="text-xs text-muted-foreground">Edit your personal details</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>

        {/* Notifications Toggle (static) */}
        <div className="flex items-center justify-between p-4 rounded-xl">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Notifications</p>
              <p className="text-xs text-muted-foreground">Manage push and email alerts</p>
            </div>
          </div>
          <div className="h-6 w-10 bg-primary rounded-full relative cursor-pointer">
            <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
          </div>
        </div>

        {/* Dark Mode Toggle */}
        <div
          className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent transition-colors"
          onClick={toggleDarkMode}
        >
          <div className="flex items-center gap-3">
            {darkMode ? (
              <Moon className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Sun className="w-5 h-5 text-muted-foreground" />
            )}
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Dark Mode</p>
              <p className="text-xs text-muted-foreground">
                {darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              </p>
            </div>
          </div>
          {/* Toggle switch */}
          <div
            className={`h-6 w-10 rounded-full relative transition-colors duration-200 ${
              darkMode ? 'bg-primary' : 'bg-gray-300'
            }`}
          >
            <div
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${
                darkMode ? 'right-1' : 'left-1'
              }`}
            />
          </div>
        </div>

        {/* Language (static) */}
        <div className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-muted-foreground" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Language</p>
              <p className="text-xs text-muted-foreground">English</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Privacy Policy */}
        <div
          className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer"
          onClick={() => alert('Privacy Policy:\nWe collect personal information to provide our services. We never share your data without consent.')}
        >
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-muted-foreground" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Privacy Policy</p>
              <p className="text-xs text-muted-foreground">How we handle your data</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Terms of Service */}
        <div
          className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer"
          onClick={() => alert('Terms of Service:\nBy using Scootlink, you agree to our rental terms and payment policies.')}
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-muted-foreground" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Terms of Service</p>
              <p className="text-xs text-muted-foreground">Our usage terms</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* Logout button */}
      <button
        onClick={() => {
          // Replace with your actual logout logic
          localStorage.clear();
          window.location.href = '/auth';
        }}
        className="w-full mt-8 flex items-center justify-center gap-2 p-4 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors font-medium"
      >
        <LogOut className="w-4 h-4" />
        Logout
      </button>
    </div>
  );
}
