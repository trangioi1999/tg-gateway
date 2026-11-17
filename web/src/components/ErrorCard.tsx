import Button from "./Button";
export default function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-card" role="alert"><p>{message}</p><Button className="btn" onClick={onRetry}>Thử lại</Button></div>;
}
