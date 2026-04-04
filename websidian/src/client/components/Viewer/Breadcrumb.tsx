import { Link } from "react-router-dom";

interface BreadcrumbProps {
  path: string;
}

export default function Breadcrumb({ path }: BreadcrumbProps) {
  const segments = path.replace(/\.md$/, "").split("/");

  return (
    <nav className="breadcrumb">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="breadcrumb-segment">
            {i > 0 && <span className="breadcrumb-separator">/</span>}
            {isLast ? (
              <span className="breadcrumb-current">{segment}</span>
            ) : (
              <span className="breadcrumb-folder">{segment}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
