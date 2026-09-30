# Prompt IDE — Mini Packet Tracer (PWA)

## Rôle & règles de travail
Tu es un dev senior React/TypeScript avec une solide connaissance de Cisco IOS (niveau CCNA).
- **Avant d'écrire du code** : propose l'arborescence, le modèle de données et le découpage en lots. Attends ma validation.
- Implémente **lot par lot**, jamais plusieurs à la fois. Chaque lot doit compiler, passer ses tests et rester utilisable.
- Pas de scope creep : rien qui ne soit listé ici. Si une idée te semble utile, propose-la, ne l'implémente pas.
- Zéro régression : les tests existants doivent rester verts à chaque lot.

## Produit
PWA installable, **mobile-first**, qui simule un réseau logique Cisco (pas de vue physique) : on pose des équipements sur un canevas, on les relie, on les configure en CLI IOS, on teste avec ping/traceroute.
- UI en **anglais**.
- 100 % hors-ligne, aucune dépendance serveur.

## Stack
- React 18 + TypeScript strict + Vite + Tailwind CSS
- **React Flow** (`@xyflow/react`) pour le canevas
- `vite-plugin-pwa` (service worker + manifest)
- IndexedDB via `idb` (ou Dexie) pour la persistance
- Zustand pour l'état UI
- Vitest pour les tests du moteur

## Architecture (impératif)
Séparer strictement :
1. **`/engine`** — TypeScript pur, **zéro import React**. Modèle réseau, parseur CLI, exécution des commandes, calcul des tables, simulation ping/traceroute. Entièrement testé avec Vitest.
2. **`/ui`** — React, consomme le moteur via le store. Aucune logique réseau dans les composants.

Le moteur doit être déterministe et sérialisable (un projet = un objet JSON).

## Équipements
| Type | Modèle de référence | Ports | CLI IOS |
|---|---|---|---|
| Switch L2 | 2960 | Fa0/1–24, Gi0/1–2 | Oui |
| Switch L3 | 3560 | Fa0/1–24, Gi0/1–2 | Oui (+ SVI, `ip routing`) |
| Routeur | ISR 1941 | Gi0/0–0/1, Se0/0/0–0/0/1 | Oui |
| PC / Serveur | — | Fa0 | Non : formulaire IP/masque/gateway + terminal limité (`ping`, `tracert`, `ipconfig`) |

## Canevas (mobile-first)
- Ajouter un équipement via une palette (bottom sheet sur mobile).
- Déplacer, renommer, supprimer un nœud. Pan / pinch-zoom tactile.
- **Création de lien avec choix manuel des ports** : tap équipement A → choix du port libre → tap équipement B → choix du port libre. Un port ne peut porter qu'un lien.
- Libellés de ports affichés sur les liens. Indicateur d'état du lien (vert up/up, rouge down).
- Tap sur un équipement → ouvre sa CLI en **plein écran** (ou le formulaire pour un PC). Bouton retour au canevas.

## CLI IOS
### Comportement
- Modes : user EXEC `>`, privileged `#`, global config `(config)#`, `(config-if)#`, `(config-if-range)#`, `(config-vlan)#`, `(config-router)#`, `(config-line)#`, `(dhcp-config)#`, `(config-subif)#`.
- Prompt exact : `Hostname>`, `Hostname(config-if)#`, etc.
- **Abréviations** non ambiguës (`conf t`, `int g0/0`, `sh ip int br`) et **Tab** pour compléter.
- **`?`** : aide contextuelle (liste des commandes / arguments possibles au point courant).
- **Erreurs IOS fidèles** : `% Invalid input detected at '^' marker.` avec le `^` bien placé, `% Incomplete command.`, `% Ambiguous command: "..."`.
- **Historique** flèches haut/bas (+ boutons sur mobile).
- **Forme `no`** pour toute commande de config qui la supporte.
- `do` depuis les modes config. `end`, `exit`, Ctrl+Z (bouton sur mobile).
- Clavier mobile : barre d'accès rapide au-dessus du clavier (Tab, ?, ↑, ↓, Ctrl+Z).

### Parseur
Implémenter un **arbre de commandes déclaratif** par mode (nœud = mot-clé ou type d'argument : `ip`, `mask`, `interface`, `number range`, `word`…). Abréviations, `?`, Tab et erreurs `^` doivent tous dériver de cet arbre — pas de `if/else` par commande.

### Commandes à supporter (par lot)
**Base**
- `enable`, `disable`, `configure terminal`, `hostname`, `enable secret`, `banner motd`, `line console 0` / `line vty 0 4` + `password` / `login`, `service password-encryption`
- `interface <type><n>`, `interface range`, `ip address`, `shutdown`, `description`, `duplex`, `speed`, `clock rate` (DCE serial)
- `show running-config`, `show startup-config`, `show ip interface brief`, `show interfaces [x]`, `show version`, `copy running-config startup-config`, `write memory`, `reload`

**VLAN & trunk**
- `vlan <id>` + `name`, `switchport mode access|trunk`, `switchport access vlan`, `switchport trunk allowed vlan`, `switchport trunk native vlan`
- Router-on-a-stick : sous-interfaces `Gi0/0.10` + `encapsulation dot1Q`
- Switch L3 : `interface vlan <id>`, `ip routing`, `no switchport`
- `show vlan brief`, `show interfaces trunk`

**Routage**
- `ip route` (statique, y compris route par défaut)
- OSPF single-area : `router ospf <pid>`, `network <ip> <wildcard> area <n>`, `router-id`, `passive-interface`
- `show ip route` avec codes `C`, `L`, `S`, `S*`, `O`, distance administrative et métrique

**Services**
- DHCP : `ip dhcp pool`, `network`, `default-router`, `dns-server`, `ip dhcp excluded-address`, `ip helper-address`. Les PC peuvent passer en mode DHCP.
- NAT/PAT : `ip nat inside|outside`, `ip nat inside source static`, `ip nat pool`, `ip nat inside source list … [overload]`, `show ip nat translations`
- ACL standard et étendues (numérotées + nommées), `ip access-group in|out`, `show access-lists`

## Simulation (moteur)
- **État des liens** : up/up seulement si les deux interfaces sont `no shutdown` (les ports switch sont up par défaut, les interfaces routeur shutdown par défaut, comme IOS).
- **Tables simulées**, calculées par le moteur et visibles via `show` :
  - `show mac address-table` (apprise au fil des pings)
  - `show arp` / `show ip arp`
  - `show ip route`
  - `show ip ospf neighbor` — OSPF : voisinage établi si même réseau, même area, interfaces up, non passives ; routes `O` calculées par SPF (Dijkstra, coût = 10^8 / bande passante).
- **STP non simulé** : hors scope. Le forwarding L2 doit se protéger des boucles (ensemble de nœuds visités).
- **Ping / traceroute calculés** (pas d'animation) : résolution logique saut par saut — VLAN/trunk, ARP, lookup table de routage (longest prefix match), ACL, NAT. Résultat texte fidèle IOS (`!!!!!`, `.....`, `U.U.U`, sortie traceroute avec les sauts). Le premier ping peut perdre le premier paquet (ARP) comme sur un vrai IOS.
- Accessible depuis la CLI des équipements Cisco et le terminal des PC.

## Persistance
- Plusieurs projets sauvegardés en **IndexedDB** (liste, créer, renommer, dupliquer, supprimer).
- Autosave debouncé.
- `copy run start` / `write` : sépare vraiment running et startup config. `reload` recharge la startup.
- Pas d'export/import ni de partage pour l'instant.

## À prévoir dans l'archi, sans implémenter
- **Mode labs** (topologie pré-remplie + consignes + vérification auto) : le moteur doit permettre d'interroger l'état réseau par des fonctions pures (ex. `canPing(a, b)`, `getRoute(device, prefix)`), pour que la vérif auto soit triviale plus tard.

## Lots proposés
1. Setup projet (Vite, Tailwind, PWA, Vitest) + modèle de données du moteur + canevas React Flow (ajout, déplacement, suppression, liens avec choix de ports) + persistance IndexedDB.
2. Parseur CLI (arbre, modes, abréviations, Tab, `?`, erreurs `^`, historique, `no`, `do`) + commandes **Base** + UI terminal mobile.
3. Équipements PC (formulaire + terminal) + état des liens + ping/traceroute sur réseau plat et routage connecté.
4. **VLAN & trunk** + router-on-a-stick + switch L3 + tables MAC/ARP.
5. **Routage** statique + OSPF + `show ip route` complet.
6. **Services** : DHCP, puis ACL, puis NAT/PAT.

Chaque lot : tests Vitest du moteur pour chaque commande et chaque scénario ping (cas qui passe + cas qui échoue).

Commence par me proposer l'architecture détaillée (arborescence, types TypeScript principaux du modèle, structure de l'arbre de commandes) et attends mon feu vert.
