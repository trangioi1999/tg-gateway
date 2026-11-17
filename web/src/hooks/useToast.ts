import { useState } from "react";
export interface ToastMessage { id: number; text: string }
export function useToast(): [ToastMessage, (text: string) => void] {
  const [message, setMessage] = useState<ToastMessage>({ id: 0, text: "" });
  return [message, (text) => setMessage(previous => ({ id: previous.id + 1, text }))];
}
