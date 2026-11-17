import Link from "next/link";
import { notFound } from "next/navigation";
import { DocForm } from "@/components/DocForm";
import { PageHeader } from "@/components/ui";
import { DOC_META, docHref, isDocKind } from "@/lib/docs-meta";
import { formOptions, prefill } from "@/server/queries";

export default async function NewDocPage({ params, searchParams }: PageProps<"/docs/[kind]/new">) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const sp = await searchParams;
  const from = Number(sp.from) || null;
  const [options, pre] = await Promise.all([formOptions(), from ? prefill(kind, from) : Promise.resolve(null)]);
  const meta = DOC_META[kind];

  const needsSource = kind === "purchase_bill" || kind === "sales_return";
  if (needsSource && !pre) {
    return (
      <>
        <PageHeader title={`New ${meta.title}`} />
        <p className="text-sm text-slate-600">
          A {meta.title.toLowerCase()} is created from its source document.{" "}
          <Link className="text-sky-700 underline" href={docHref(kind === "purchase_bill" ? "grn" : "sales_invoice")}>
            Pick one here
          </Link>
          .
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`New ${meta.title}`}
        subtitle={pre ? `From ${String(pre.header.sourceNo)}` : meta.blurb}
      />
      <DocForm kind={kind} options={options} prefill={pre} />
    </>
  );
}
