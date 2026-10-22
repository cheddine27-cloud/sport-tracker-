import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoon } from "@/components/layout/ComingSoon";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="لوحة التحكم"
        description="نظرة عامة على نشاط المحل"
      />
      <ComingSoon />
    </>
  );
}
