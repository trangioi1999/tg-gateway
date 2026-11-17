import Skeleton from "./Skeleton";
export default function OverviewSkeleton() {
  return <>
    <div className="quota"><Skeleton className="card skeleton-card" rows={3} /><div className="kpis">{[0,1,2,3].map(i => <Skeleton key={i} className="card skeleton-card" rows={2} />)}</div></div>
    <div className="row3">{[0,1,2].map(i => <Skeleton key={i} className="card skeleton-card" rows={4} />)}</div>
  </>;
}
