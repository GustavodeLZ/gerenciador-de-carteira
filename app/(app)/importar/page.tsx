import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { CLASSES } from "@/lib/carteira";
import { ImportarB3 } from "@/components/importar-b3";
import { NotaUpload } from "@/components/nota-upload";

export default async function Importar() {
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  return (
    <div className="grid">
      <ImportarB3 classes={CLASSES} />
      <NotaUpload classes={CLASSES} segmentos={c.segmentos.map((s) => ({ id: s.id, nome: s.nome }))} />
      <p className="faint small" style={{ margin: 0 }}>
        Importar de novo é seguro: cada linha tem um identificador e o que já foi importado é ignorado.
        Para segmentos, depois da importação use a página Segmentos ou a página de cada ativo.
      </p>
    </div>
  );
}
