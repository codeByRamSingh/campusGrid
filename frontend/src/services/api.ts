import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("campusgrid_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type LoginResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    role: "SUPER_ADMIN" | "STAFF";
    permissions: string[];
    staff: null | {
      id: string;
      fullName: string;
      collegeId: string;
      role: string;
      isActive: boolean;
    };
  };
};
