"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PurchasesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/accounting?tab=purchases");
  }, [router]);

  return null;
}
