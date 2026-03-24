import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function makeId() {
  return crypto.randomUUID();
}

export function toTitle(input: string) {
  const cleaned = input.trim();
  return cleaned.length ? cleaned : "Новая заметка";
}

export function deviceNameFromNavigator() {
  if (typeof navigator === "undefined") {
    return "Unknown device";
  }

  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("iphone")) {
    return "iPhone";
  }

  if (ua.includes("ipad")) {
    return "iPad";
  }

  if (ua.includes("android")) {
    return "Android";
  }

  if (ua.includes("mac os")) {
    return "Mac";
  }

  if (ua.includes("windows")) {
    return "Windows PC";
  }

  return "Browser device";
}
