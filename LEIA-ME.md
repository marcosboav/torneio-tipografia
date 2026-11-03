# Torneio de Tipografia

Site para conduzir um torneio de desenho de letras: duelos 1 contra 1, letra sorteada, votação anónima pelo telemóvel, fase suíça seguida de eliminatórias, e histórico com todas as fotografias.

## Páginas

| Página | Para quem | O que faz |
| --- | --- | --- |
| `index.html` | Alunos (telemóvel) | Entrar com o código e votar nos duelos abertos |
| `professor.html` | Professor | Criar torneios, sortear letras, carregar fotos, abrir e fechar votações |
| `ecra.html` | Projetor | Letra e cronómetro, duelo em votação, resultado, classificação, campeão |
| `historico.html` | Todos | Todos os torneios, rondas e desenhos, com filtro por aluno |

Sem configuração, o site corre em **modo demonstração**: os dados ficam só no browser onde foram criados. Serve para experimentar, não para a aula.

## 1. Ligar ao Supabase (uma vez)

1. Cria conta em [supabase.com](https://supabase.com) e um projeto novo (região: Europa).
2. **Conta de professor:** Authentication → Users → *Add user* → *Create new user*. Usa o teu email e uma palavra-passe, e marca *Auto Confirm User*.
3. **Fechar registos:** Authentication → Sign In / Providers → desliga *Allow new users to sign up*.
4. **Base de dados:** SQL Editor → *New query* → cola todo o ficheiro `supabase/schema.sql`. Na linha `insert into public.admins`, troca `EMAIL-DO-PROFESSOR@exemplo.com` pelo email do passo 2. Carrega em *Run*.
5. **Chaves:** Project Settings → API Keys. Copia o *Project URL* e a chave *anon public* para `js/config.js`:

   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

   A chave *anon public* pode estar no site: as regras de segurança estão na base de dados. **Nunca** uses a chave *service_role* ou *secret*.

## 2. Publicar no GitHub Pages

1. Cria um repositório público no GitHub e envia para lá o conteúdo desta pasta (`index.html` tem de ficar na raiz).
2. No repositório: Settings → Pages → *Deploy from a branch* → `main` / `(root)` → *Save*.
3. Ao fim de um ou dois minutos o site fica em `https://<utilizador>.github.io/<repositório>/`.

Depois de cada atualização do site, recarrega as páginas com **Ctrl+F5** para o browser não usar ficheiros antigos.

## 3. Antes da aula

1. Abre `professor.html`, entra e cria o torneio com os nomes dos alunos (primeiro nome ou alcunha).
2. Em *Alunos e códigos* → *Imprimir cartões*. Cada cartão tem o código e um QR que já entra com esse código.
3. Experimenta com o teu telemóvel: o teu código de voto aparece no separador *Ronda*.

## 4. Na aula

1. Liga o projetor em `ecra.html` (botão *Ecrã inteiro* no canto inferior direito, visível ao passar o rato).
2. Em *Ronda*: sorteia a letra, escreve a restrição se quiseres, confirma os duelos e carrega em **Começar**.
3. **Iniciar cronómetro.** O ecrã mostra a letra e o tempo, e toca quando acaba.
4. Fotografa os desenhos com o telemóvel (*Carregar foto* em cada lado). O lado A/B é sorteado, por isso a sala não sabe de quem é cada desenho.
5. **Abrir votação** num duelo de cada vez (aparece em grande no ecrã) ou **Abrir todas** de uma vez.
6. **Fechar votação:** o ecrã revela os nomes e o vencedor durante 15 segundos.
7. Com todos os duelos fechados, **Concluir ronda** e preparar a seguinte.

## Regras implementadas

- **Votos:** votam todos os alunos e o professor, menos os dois do duelo. Com 18 alunos são 17 votos, sem empates. Com um número ímpar de alunos pode haver empate: o site pede-te para escolher o vencedor.
- **Fase suíça:** a ronda 1 é aleatória; nas seguintes, emparelha por número de vitórias, sem repetir adversários. Com número ímpar de alunos há uma folga por ronda (conta como vitória, nunca duas vezes para o mesmo aluno).
- **Classificação:** vitórias → votos recebidos → confronto direto → força dos adversários (soma das vitórias de quem defrontaste).
- **Eliminatórias:** 1.º–8.º, 4.º–5.º, 2.º–7.º, 3.º–6.º, evitando repetir duelos da fase suíça. Se houver empate total na linha de corte, o site mostra quem está empatado e tu escolhes quem passa (por exemplo, depois de um duelo-relâmpago).
- **Tempos sugeridos:** 5 min na fase suíça e nos quartos, 7 nas meias, 10 na final. Podes mudar em cada ronda.

## Privacidade

O site é público: quem tiver o endereço vê o histórico, os nomes e as fotografias. Usa só primeiros nomes ou alcunhas e fotografa apenas os desenhos. Os códigos servem só para votar.

## Testes

`node tests/logic.test.mjs` simula 700 torneios completos e confirma as regras acima.
