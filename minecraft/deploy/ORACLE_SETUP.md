# Oracle Cloud — Setup OpenWorld (5 min)

## 1. Criar conta (se não tem)

1. Vai em https://cloud.oracle.com/
2. Clica "Sign Up" → "Oracle Cloud Free Tier"
3. Preenche nome, email, país
4. Coloca cartão (NÃO cobra, é só verificação)
5. Seleciona "Home Region" → **US East (Ashburn)** ou **Brazil East (Sao Paulo)**

## 2. Criar instância ARM (GRÁTIS)

1. No painel, vai em **Compute → Instances → Create Instance**
2. Configurações:
   - **Name**: `openworld`
   - **Image**: Ubuntu 22.04 (ou 24.04)
   - **Shape**: Clica "Change Shape" → **Ampere** → **VM.Standard.A1.Flex**
     - OCPUs: **4**
     - Memory: **24 GB**
     - (Tudo isso é free tier!)
   - **Network**: Cria uma nova VCN ou usa a default
   - **SSH Key**: Upload sua chave pública (`~/.ssh/id_rsa.pub`)
     - Se não tem: `ssh-keygen -t rsa -b 4096` no terminal
3. Clica **Create**
4. Espera 1-2 min, copia o **Public IP**

## 3. Abrir portas (Security List)

1. No painel da instância, clica no link da **Subnet**
2. Clica na **Security List** → **Add Ingress Rules**
3. Adiciona estas regras (uma por uma):

| Source CIDR | Protocol | Destination Port | Description |
|-------------|----------|-----------------|-------------|
| 0.0.0.0/0 | TCP | 25565 | Minecraft |
| 0.0.0.0/0 | TCP | 3001 | Bridge API |
| 0.0.0.0/0 | TCP | 3007 | 3D Viewer |
| 0.0.0.0/0 | TCP | 8200 | BlueMap |

## 4. Deploy (1 comando)

No seu terminal local (na pasta openworld/minecraft):

```bash
chmod +x deploy/deploy.sh deploy/setup.sh
./deploy/deploy.sh ubuntu@SEU_IP_PUBLICO
```

Espera ~5 min. Pronto!

## 5. Testar

```bash
# API
curl http://SEU_IP:3001/api/health

# Census
curl http://SEU_IP:3001/api/census

# BlueMap (browser)
http://SEU_IP:8200

# Conectar OpenClaw: aponte pra
http://SEU_IP:3001/skill.md
```

## 6. Conectar OpenClaw

No Claude Code, o OpenClaw só precisa saber o URL:
```
http://SEU_IP:3001/skill.md
```

Ele lê a doc, registra, conecta, e começa a viver autonomamente.

## Custos

**$0/mês.** A instância ARM (4 OCPU, 24GB RAM) é Always Free.
Só paga se ultrapassar os limites de storage (200GB free) ou bandwidth (10TB free).
