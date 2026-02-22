$(document).ready(function () {
    // 1. Auth Check
    Auth.checkAuth();
    const currentUser = Auth.getCurrentUser();
    $('#displayUsername').text(currentUser.username);

    // 2. State Management
    let treeData = [];
    const treeKey = `family_tree_${currentUser.username}`;

    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ── Toast Notification System ───────────────────────────────────
    function showToast(message, type = 'info') {
        const icons = {
            success: '✓',
            error: '✕',
            info: 'ℹ',
            warning: '⚠'
        };
        const $toast = $(`
            <div class="toast toast-${type}">
                <span class="toast-icon">${icons[type] || icons.info}</span>
                <span>${message}</span>
            </div>
        `);
        $('#toastContainer').append($toast);

        setTimeout(() => {
            $toast.addClass('toast-exit');
            setTimeout(() => $toast.remove(), 300);
        }, 3000);
    }

    // ── Data Persistence ────────────────────────────────────────────
    function loadTree() {
        const stored = localStorage.getItem(treeKey);
        if (stored) {
            treeData = JSON.parse(stored);
        }

        // If empty (new user), seed with "Me"
        if (!treeData || treeData.length === 0) {
            treeData = [{
                id: generateUUID(),
                name: "Me",
                relation: "Self",
                gender: "Male",
                parentId: null,
                children: []
            }];
            saveTree();
        }
        renderTree();
    }

    function saveTree() {
        localStorage.setItem(treeKey, JSON.stringify(treeData));
    }

    // ── Hierarchy Builder ───────────────────────────────────────────
    function buildHierarchy(flatData) {
        const map = new Map();
        flatData.forEach(node => {
            map.set(node.id, { ...node, children: [], _isSpouse: false });
        });

        // 1. Link Spouses and Deterministically Assign Drawer
        flatData.forEach(node => {
            const currentNode = map.get(node.id);
            if (node.spouseId) {
                const spouse = map.get(node.spouseId);
                const spouseOriginal = flatData.find(n => n.id === node.spouseId);

                if (spouse && spouseOriginal) {
                    currentNode._spouseNode = spouse;

                    // Deterministic Draw Assignment:
                    // 1. A node with parents always draws the couple (it must nest under them).
                    // 2. If both have parents, the one NOT married-out draws the couple.
                    // 3. If neither have parents, fallback to ID comparison.
                    if (node.parentId && !spouseOriginal.parentId) {
                        currentNode._drawCouple = true;
                    } else if (!node.parentId && spouseOriginal.parentId) {
                        currentNode._drawCouple = false;
                    } else if (node.parentId && spouseOriginal.parentId) {
                        // The one who isn't 'married-out' should draw the primary lineage block
                        currentNode._drawCouple = (node.relation !== 'Spouse' && spouseOriginal.relation === 'Spouse');
                        // Fallback logic if both are somehow equal
                        if (node.relation === 'Spouse' && spouseOriginal.relation === 'Spouse') {
                            currentNode._drawCouple = node.id < spouseOriginal.id;
                        }
                    } else {
                        // Neither have parents, standard fallback
                        currentNode._drawCouple = node.id < spouseOriginal.id;
                    }
                }
            }
        });

        // 2. Identify "married-out" nodes
        // Only ONE node in a marriage should be 'married-out' if they have parents.
        // We look for nodes explicitly added as 'Spouse' to be the ones separated to Origin Families.
        const marriedOut = new Set();
        flatData.forEach(node => {
            if (node.spouseId && node.parentId) {
                const spouse = flatData.find(n => n.id === node.spouseId);

                if (node.relation === 'Spouse') {
                    marriedOut.add(node.id);
                } else if (spouse && spouse.parentId && spouse.relation !== 'Spouse') {
                    // Fallback: If both have parents and neither is literally "Spouse", pick lower ID
                    if (node.id > spouse.id) {
                        marriedOut.add(node.id);
                    }
                }
            }
        });

        // 3. Build parent-child relationships (skip married-out nodes)
        flatData.forEach(node => {
            const currentNode = map.get(node.id);
            if (node.parentId && !marriedOut.has(node.id)) {
                const parent = map.get(node.parentId);
                if (parent) {
                    parent.children.push(currentNode);
                }
            }
        });

        // 4. Add linked placeholder in the spouse's parent tree
        marriedOut.forEach(nodeId => {
            const node = flatData.find(n => n.id === nodeId);
            const parent = map.get(node.parentId);
            const spouse = map.get(node.spouseId);
            if (parent) {
                parent.children.push({
                    id: nodeId + '_link',
                    name: node.name,
                    gender: node.gender,
                    _isLinkedSpouse: true,
                    _linkedPartnerName: spouse ? spouse.name : '',
                    children: []
                });
            }
        });

        // 5. Find roots
        const roots = [];
        flatData.forEach(node => {
            if (node.parentId) return;

            const currentNode = map.get(node.id);

            // Married-out nodes are NOT roots (they appear in couple)
            if (marriedOut.has(node.id)) return;

            if (currentNode.spouseId) {
                const spouse = map.get(currentNode.spouseId);

                // My spouse is married-out → I'm still a root with the couple if I have no parents
                if (spouse && marriedOut.has(spouse.id)) {
                    currentNode._isMainFamily = true;
                    roots.push(currentNode);
                }
                // Determine root based strictly on the deterministic `_drawCouple` value
                else if (spouse && !spouse.parentId && currentNode._drawCouple) {
                    roots.push(currentNode);
                } else {
                    // Skip if the spouse lacks parents but they don't have drawing priority.
                    // This explicitly prevents spouses like 'Prabha' from falsely escalating
                    // to a Top-Level Root simply because they lack parentage!
                }
            } else {
                roots.push(currentNode);
            }
        });

        // Mark origin-family roots
        marriedOut.forEach(nodeId => {
            const node = flatData.find(n => n.id === nodeId);
            if (node && node.parentId) {
                // Walk up to find the root of this origin family
                let current = node.parentId;
                let visited = new Set();
                while (current && !visited.has(current)) {
                    visited.add(current);
                    const parent = flatData.find(n => n.id === current);
                    if (parent && parent.parentId) {
                        current = parent.parentId;
                    } else {
                        break;
                    }
                }
                const rootNode = roots.find(r => r.id === current);
                if (rootNode) {
                    rootNode._isOriginFamily = true;
                    rootNode._originSpouseName = node.name;
                    // Tag the root with the primary spouse's linked UUID so we know who connects to what
                    rootNode._targetLinkId = node.spouseId;
                }
            }
        });

        // 6. BFS Smart Clustering
        // Re-order the roots array so that connected families spawn immediately adjacent to their target
        let sortedRoots = [];
        let visitedRoots = new Set();

        // Find the Primary Tree (the one containing 'Me')
        const meNode = flatData.find(n => n.relation === 'Self');
        let primaryRoot = roots[0];

        if (meNode) {
            let current = meNode.id;
            let visitedMe = new Set();
            while (current && !visitedMe.has(current)) {
                visitedMe.add(current);
                const parent = flatData.find(n => n.id === current);
                if (parent && parent.parentId) current = parent.parentId;
                else break;
            }
            primaryRoot = roots.find(r => r.id === current) || roots[0];
        }

        // Start BFS from Primary Root
        let queue = [primaryRoot];

        while (queue.length > 0) {
            const currentRoot = queue.shift();
            if (!currentRoot || visitedRoots.has(currentRoot.id)) continue;

            visitedRoots.add(currentRoot.id);
            sortedRoots.push(currentRoot);

            // Find all Origin Families that link into THIS root's tree
            // A root's tree contains all descendants of that root.
            // For now, an approximation: just look for origin roots that target any node in flatData.
            // To be precise: we look for any unvisited root whose `_targetLinkId` exists within the current root's descendant tree.
            // Since traversing the exact tree is slow, we can just group by direct linkage.
            roots.forEach(candidate => {
                if (candidate._isOriginFamily && !visitedRoots.has(candidate.id)) {
                    // Check if candidate targets a node inside the currentRoot's tree.
                    // To simplify: if candidate._targetLinkId is ANY node that eventually rolls up to currentRoot.
                    let t = candidate._targetLinkId;
                    let tVisited = new Set();
                    let connectsToCurrent = false;

                    while (t && !tVisited.has(t)) {
                        tVisited.add(t);
                        if (t === currentRoot.id) {
                            connectsToCurrent = true;
                            break;
                        }
                        const tNode = flatData.find(n => n.id === t);
                        if (tNode && tNode.parentId) t = tNode.parentId;
                        else break;
                    }

                    if (connectsToCurrent) {
                        queue.push(candidate);
                    }
                }
            });
        }

        // Append any isolated/unconnected roots that BFS missed
        roots.forEach(r => {
            if (!visitedRoots.has(r.id)) {
                sortedRoots.push(r);
            }
        });

        // 7. Radial/Centered Placement (e.g. 6 4 2 1 3 5 7)
        // Alternately place families to the Left and Right of the Primary tree
        // so the Primary tree is physically in the center of the canvas.
        let centeredRoots = [];
        let placeRight = true;
        for (let i = 0; i < sortedRoots.length; i++) {
            if (i === 0) {
                // Primary tree goes in first
                centeredRoots.push(sortedRoots[i]);
            } else {
                if (placeRight) {
                    centeredRoots.push(sortedRoots[i]);
                } else {
                    centeredRoots.unshift(sortedRoots[i]);
                }
                placeRight = !placeRight;
            }
        }

        return centeredRoots;
    }

    // ── Rendering ───────────────────────────────────────────────────
    function createNodeHTML(node) {
        // Linked spouse placeholder
        if (node._isLinkedSpouse) {
            return renderLinkedCard(node);
        }

        if (node._spouseNode) {
            if (node._drawCouple) {
                return createCoupleHTML(node, node._spouseNode);
            }
            return '';
        }
        return buildSingleNodeHTML(node);
    }

    function buildSingleNodeHTML(node) {
        return `
            <div class="node-wrapper">
                ${renderLeaf(node)}
                ${renderChildren(node)}
            </div>
        `;
    }

    function createCoupleHTML(node1, node2) {
        const combinedChildren = [...(node1.children || []), ...(node2.children || [])];
        const uniqueChildren = Array.from(new Map(combinedChildren.map(c => [c.id, c])).values());

        return `
            <div class="node-wrapper">
                <div class="couple-container">
                    ${renderLeaf(node1)}
                    <div class="spouse-divider"></div>
                    ${renderLeaf(node2)}
                </div>
                ${uniqueChildren.length > 0 ? `
                    <div class="children-container">
                        ${uniqueChildren.map(child => createNodeHTML(child)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderLinkedCard(node) {
        const genderClass = (node.gender || 'Other').toLowerCase();
        const originalId = node.id.replace('_link', '');
        return `
            <div class="node-wrapper">
                <div class="node-content linked-card ${genderClass}" data-id="${originalId}">
                    <div class="node-header-strip"></div>
                    <div class="node-header">
                        <div class="linked-icon">💍</div>
                        <div class="node-info">
                            <div class="node-name">${node.name}</div>
                            <div class="node-relation">Married → ${node._linkedPartnerName || 'Unknown'}</div>
                        </div>
                    </div>
                    <div class="node-actions">
                        <button class="btn-sm btn-add-parent" title="Add Parent">▲</button>
                        <button class="btn-sm btn-add-sibling" title="Add Sibling">⇔</button>
                        <button class="btn-sm btn-add-partner" title="Add Partner">♥</button>
                        <button class="btn-sm btn-add" title="Add Child">▼</button>
                        <button class="btn-sm btn-edit" title="Edit">✎</button>
                        <button class="btn-sm btn-link-action" title="Link to Another Family">🔗</button>
                        <button class="btn-sm btn-unlink-action" title="Unlink/Delete Spouse's Extended Family">✂️</button>
                        <button class="btn-sm btn-delete" title="Delete">×</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderLeaf(node) {
        const genderClass = (node.gender || 'Other').toLowerCase();
        const photoUrl = node.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(node.name)}&background=1a1a2e&color=6c63ff&bold=true&size=44`;
        const birthYear = node.dob ? new Date(node.dob).getFullYear() : '';
        const currentYear = new Date().getFullYear();
        const age = birthYear ? `<span style="opacity:0.5; font-weight:400; font-size:0.8rem;"> ${currentYear - birthYear}y</span>` : '';

        return `
            <div class="node-content ${genderClass}" data-id="${node.id}">
                <div class="node-header-strip"></div>
                <div class="node-header">
                    <img src="${photoUrl}" class="node-photo" alt="${node.name}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(node.name)}&background=1a1a2e&color=6c63ff&bold=true&size=44'">
                    <div class="node-info">
                        <div class="node-name">${node.name}${age}</div>
                        <div class="node-relation">${node.relation || ''}</div>
                    </div>
                </div>
                <div class="node-actions">
                    <button class="btn-sm btn-add-parent" title="Add Parent">▲</button>
                    <button class="btn-sm btn-add-sibling" title="Add Sibling">⇔</button>
                    <button class="btn-sm btn-add-partner" title="Add Partner">♥</button>
                    <button class="btn-sm btn-add" title="Add Child">▼</button>
                    <button class="btn-sm btn-edit" title="Edit">✎</button>
                    <button class="btn-sm btn-link-action" title="Link to Another Family">🔗</button>
                    ${(node.parentId || node.spouseId) && node.relation !== 'Self' ? `<button class="btn-sm btn-delete" title="Delete">×</button>` : ''}
                </div>
            </div>
        `;
    }

    function renderChildren(node) {
        if (!node.children || node.children.length === 0) return '';
        return `
            <div class="children-container">
                ${node.children.map(child => createNodeHTML(child)).join('')}
            </div>
        `;
    }

    function renderTree() {
        const hierarchy = buildHierarchy(treeData);

        let html = '<div id="tree-content" class="multi-tree-container">';
        hierarchy.forEach(root => {
            const isOrigin = root._isOriginFamily;
            let label = root.name === "New Family Root" ? "New Family" : (isOrigin ? `${root._originSpouseName}'s Family` : `${root.name}'s Family`);

            // Expose the delete button unconditionally for all families per user request
            const deleteBtn = `<button class="delete-family-btn" data-root-id="${root.id}" title="Delete this entire family tree">×</button>`;
            const labelDiv = `<div class="family-section-label">👨‍👩‍👧 ${label} ${deleteBtn}</div>`;

            html += `
                <div class="family-section ${isOrigin ? 'origin-family' : 'main-family'}">
                    ${labelDiv}
                    ${createNodeHTML(root)}
                </div>
            `;
        });
        html += '</div>';

        // Add SVG overlay
        html += '<svg id="svg-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0;"></svg>';

        $('#tree-root').html(html);
        $('#tree-root').css({ position: 'relative', width: 'max-content', minWidth: '100%' });

        attachNodeEvents();
        setTimeout(drawConnections, 100);
    }

    function drawConnections() {
        const svg = document.getElementById('svg-canvas');
        if (!svg) return;
        svg.innerHTML = ''; // Clear previous

        // 1. Align vertical timelines (Generations)
        // Reset transforms
        $('.family-section').css('transform', '');

        // Run alignment multiple times to allow chained family trees to settle
        for (let i = 0; i < 4; i++) {
            $('.linked-card').each(function () {
                const id = $(this).data('id');
                const realNode = $(`.node-content[data-id="${id}"]`).not('.linked-card').first();

                if (realNode.length) {
                    const linkRect = this.getBoundingClientRect();
                    const realRect = realNode[0].getBoundingClientRect();

                    const diff = realRect.top - linkRect.top;

                    // If they are unaligned by more than a couple pixels
                    if (Math.abs(diff) > 2) {
                        const linkSection = $(this).closest('.family-section');

                        // Extract current translateY
                        let currentY = 0;
                        const transform = linkSection.css('transform');
                        if (transform && transform !== 'none') {
                            const matrix = transform.match(/matrix.*\((.+)\)/);
                            if (matrix) {
                                currentY = parseFloat(matrix[1].split(', ')[5]) || 0;
                            }
                        }

                        const newY = currentY + diff;
                        linkSection.css('transform', `translateY(${newY}px)`);
                    }
                }
            });
        }

        const svgRect = svg.getBoundingClientRect();

        $('.linked-card').each(function () {
            const id = $(this).data('id');
            const realNode = $(`.node-content[data-id="${id}"]`).not('.linked-card').first();

            if (realNode.length) {
                const rect1 = this.getBoundingClientRect();
                const rect2 = realNode[0].getBoundingClientRect();

                // If either isn't visible, skip
                if (rect1.width === 0 || rect2.width === 0) return;

                const startX = rect1.left - svgRect.left + (rect1.width / 2);
                const startY = rect1.top - svgRect.top + (rect1.height / 2);

                const endX = rect2.left - svgRect.left + (rect2.width / 2);
                const endY = rect2.top - svgRect.top + (rect2.height / 2);

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

                // If mostly horizontal, bezier control points should push horizontal
                const isHorizontal = Math.abs(endX - startX) > Math.abs(endY - startY);
                if (isHorizontal) {
                    const cpH1 = startX + (endX - startX) / 2;
                    const cpH2 = startX + (endX - startX) / 2;
                    path.setAttribute("d", `M ${startX} ${startY} C ${cpH1} ${startY}, ${cpH2} ${endY}, ${endX} ${endY}`);
                } else {
                    const cp1Y = startY + Math.abs(endY - startY) / 2 + 50;
                    const cp2Y = endY - Math.abs(endY - startY) / 2 - 50;
                    path.setAttribute("d", `M ${startX} ${startY} C ${startX} ${cp1Y}, ${endX} ${cp2Y}, ${endX} ${endY}`);
                }

                path.setAttribute("fill", "none");
                path.setAttribute("stroke", "rgba(108, 99, 255, 0.4)");
                path.setAttribute("stroke-width", "3");
                path.setAttribute("stroke-dasharray", "8, 6");

                svg.appendChild(path);
            }
        });
    }

    // ── Event Handlers ──────────────────────────────────────────────
    function attachNodeEvents() {
        $('.node-content').on('click', function (e) {
            if ($(e.target).closest('button').length) return;
        });

        // Add Child
        $('.btn-add').click(function () {
            const id = $(this).closest('.node-content').data('id');
            openModal(null, id, false, false);
        });

        // Add Parent
        $('.btn-add-parent').click(function () {
            const id = $(this).closest('.node-content').data('id');
            const node = treeData.find(n => n.id === id);

            if (node.parentId) {
                const parent = treeData.find(n => n.id === node.parentId);
                if (parent.spouseId) {
                    showToast('Both parents already exist!', 'warning');
                } else {
                    if (confirm(`Parent(${parent.name}) exists.Add Spouse(Mother / Father) to them ? `)) {
                        openModal(null, parent.id, false, true);
                    }
                }
            } else {
                openModal(null, id, true, false);
            }
        });

        // Add Partner
        $('.btn-add-partner').click(function () {
            const id = $(this).closest('.node-content').data('id');
            const node = treeData.find(n => n.id === id);
            if (node.spouseId) {
                showToast('Partner/Spouse already exists!', 'warning');
            } else {
                openModal(null, id, false, true);
            }
        });

        // Add Sibling
        $('.btn-add-sibling').click(function () {
            const id = $(this).closest('.node-content').data('id');
            const node = treeData.find(n => n.id === id);
            if (node.parentId) {
                openModal(null, node.parentId, false, false);
            } else {
                if (confirm('No parent exists. Create a placeholder parent to add a sibling?')) {
                    const newParentId = generateUUID();
                    const newParent = {
                        id: newParentId,
                        name: "Unknown Parent",
                        relation: "Parent",
                        parentId: null
                    };

                    if (node.relation === 'Self') {
                        newParent.name = "Parent";
                    }

                    treeData.push(newParent);
                    node.parentId = newParentId;
                    saveTree();
                    openModal(null, newParentId, false, false);
                }
            }
        });

        // Edit
        $('.btn-edit').click(function () {
            const id = $(this).closest('.node-content').data('id');
            const member = treeData.find(n => n.id === id);
            openModal(member, null, false, false);
        });

        // Delete Member
        $('.btn-delete').click(function () {
            const id = $(this).closest('.node-content').data('id');
            if (confirm('Delete this member and all their descendants?')) deleteMember(id);
        });

        // Link to Another Family
        $('.btn-link-action').click(function () {
            const id = $(this).closest('.node-content').data('id');
            const member = treeData.find(n => n.id === id);
            openLinkModal(member);
        });

        // Unlink/Delete Spouse's Family
        $('.btn-unlink-action').click(function () {
            const id = $(this).closest('.node-content').data('id');
            if (confirm("Sever the connection to the spouse's extended family and delete them? The spouse and your main tree will remain intact.")) {
                deleteSpouseFamily(id);
            }
        });

        // Delete Entire Family Section
        $('.delete-family-btn').click(function () {
            const rootId = $(this).data('root-id');
            if (confirm("Are you sure you want to permanently delete this entire family tree?")) {
                deleteWholeFamily(rootId);
            }
        });
    }

    // ── Delete Family ───────────────────────────────────────────────
    function deleteWholeFamily(rootId) {
        // We only want to delete descendants of this root and their married-in spouses.
        // We DO NOT want to traverse "upstream" into the Main Family if a member of this 
        // deleted family was married to someone in the Main Family.

        let toDeleteIds = new Set();
        let queue = [rootId];

        // First Pass: Find all true descendants of the Root
        while (queue.length > 0) {
            const currentId = queue.shift();
            if (!toDeleteIds.has(currentId)) {
                toDeleteIds.add(currentId);

                // Find all children of this node
                treeData.forEach(n => {
                    if (n.parentId === currentId && !toDeleteIds.has(n.id)) {
                        queue.push(n.id);
                    }
                });
            }
        }

        // Second Pass: Add all spouses of the people we are deleting, 
        // BUT ONLY IF those spouses do not have parents outside of this deletion group.
        // E.g., if Prabha is being deleted, Thangevel (her father) is deleted.
        // Prabha (node) is a descendant. Her spouse is Mahesh.
        // Mahesh has a parent (Shakthivel) who is NOT in the deletion group.
        // Therefore, we DO NOT delete Mahesh.
        treeData.forEach(node => {
            if (toDeleteIds.has(node.id) && node.spouseId) {
                const spouse = treeData.find(n => n.id === node.spouseId);
                if (spouse) {
                    // If the spouse has no parents, or their parents are also being deleted, they belong to this isolated family
                    if (!spouse.parentId || toDeleteIds.has(spouse.parentId)) {
                        toDeleteIds.add(spouse.id);
                        // Make sure we also sweep any unique children of this spouse if they weren't caught
                        treeData.forEach(child => {
                            if (child.parentId === spouse.id) toDeleteIds.add(child.id);
                        });
                    }
                }
            }
        });

        // Third Pass: Salvage any descendant who is married to a survivor outside the deletion group,
        // or who is a child of a salvaged survivor. 
        // We do this iteratively until no more salvages are found.
        let salvaged = true;
        while (salvaged) {
            salvaged = false;
            for (let id of Array.from(toDeleteIds)) {
                const node = treeData.find(n => n.id === id);
                if (!node) continue;

                // Salvage condition 1: Married to a survivor outside the deletion group
                let shouldSalvage = (node.spouseId && !toDeleteIds.has(node.spouseId));

                // Salvage condition 2: Child of a survivor
                if (!shouldSalvage && node.parentId && !toDeleteIds.has(node.parentId)) {
                    shouldSalvage = true;
                }

                if (shouldSalvage) {
                    toDeleteIds.delete(id);
                    salvaged = true;
                }
            }
        }

        // Convert Set to Array for easier handling
        toDeleteIds = Array.from(toDeleteIds);

        // Before deleting, ensure any nodes in the Main Tree who were married into this deleted family
        // have their `spouseId` pointers cleared, otherwise they will hold dead links.
        treeData.forEach(node => {
            if (node.spouseId && toDeleteIds.includes(node.spouseId)) {
                // If I am NOT being deleted, but my spouse IS being deleted, sever my link to them
                if (!toDeleteIds.includes(node.id)) {
                    node.spouseId = null;
                }
            }
            if (node.parentId && toDeleteIds.includes(node.parentId)) {
                if (!toDeleteIds.includes(node.id)) {
                    node.parentId = null;
                }
            }
        });

        // Remove all nodes mapped to this family tree
        treeData = treeData.filter(node => !toDeleteIds.includes(node.id));

        saveTree();
        renderTree();
        showToast("Family tree deleted successfully.", "info");
    }

    // ── Modal ───────────────────────────────────────────────────────
    const modal = $('#memberModal');
    let isAddingParent = false;
    let isAddingSpouse = false;
    let targetId = null;

    function openModal(member, _targetId, addingParent, addingSpouse) {
        $('#memberForm')[0].reset();
        $('#nodeId').val('');
        isAddingParent = addingParent;
        isAddingSpouse = addingSpouse;
        targetId = _targetId;

        if (member) {
            $('#modalTitle').text('Edit Member');
            $('#nodeId').val(member.id);
            $('#name').val(member.name);
            $('#relation').val(member.relation);
            $('#gender').val(member.gender);
            $('#dob').val(member.dob);
            $('#location').val(member.location);
            $('#address').val(member.address);
            $('#notes').val(member.notes);
            $('#photo').val(member.photo);
        } else if (addingParent) {
            $('#modalTitle').text('Add Parent');
        } else if (addingSpouse) {
            $('#modalTitle').text('Add Spouse');
            $('#relation').val('Spouse');
        } else {
            $('#modalTitle').text('Add Child');
        }

        modal.addClass('active');
    }

    function closeModal() {
        modal.removeClass('active');
        isAddingParent = false;
        targetId = null;
    }

    $('#memberModal .close-modal, #memberModal .close-modal-btn').click(closeModal);

    $(window).click(function (e) {
        if ($(e.target).is(modal)) closeModal();
        if ($(e.target).is($('#linkModal'))) closeLinkModal();
    });

    // ── Link Modal ──────────────────────────────────────────────────
    function openLinkModal(sourceMember) {
        $('#linkForm')[0].reset();
        $('#linkSourceId').val(sourceMember.id);
        $('#linkSourceName').text(sourceMember.name);

        // Populate target dropdown with all other members
        const $targetSelect = $('#linkTargetId');
        $targetSelect.empty();
        $targetSelect.append('<option value="" disabled selected>Select a Member</option>');

        treeData.forEach(node => {
            if (node.id !== sourceMember.id) {
                $targetSelect.append(`<option value="${node.id}">${node.name} (${node.relation})</option>`);
            }
        });

        $('#linkModal').addClass('active');
    }

    function closeLinkModal() {
        $('#linkModal').removeClass('active');
    }

    $('#linkModal .close-modal, #linkModal .close-modal-btn').click(closeLinkModal);

    $('#linkForm').submit(function (e) {
        e.preventDefault();
        const sourceId = $('#linkSourceId').val();
        const targetId = $('#linkTargetId').val();
        const relation = $('#linkRelation').val();

        if (!sourceId || !targetId || !relation) return;

        const sourceNode = treeData.find(n => n.id === sourceId);
        const targetNode = treeData.find(n => n.id === targetId);

        if (relation === 'Spouse') {
            sourceNode.spouseId = targetId;
            targetNode.spouseId = sourceId;
            sourceNode.relation = 'Spouse';
        } else if (relation === 'Child') {
            sourceNode.parentId = targetId;
            sourceNode.relation = 'Child';
        } else if (relation === 'Parent') {
            targetNode.parentId = sourceId;
            sourceNode.relation = 'Parent';
        }

        saveTree();
        renderTree();
        closeLinkModal();
        showToast(`Successfully linked ${sourceNode.name} to ${targetNode.name}!`, 'success');
    });

    // ── Form Submit ─────────────────────────────────────────────────
    $('#memberForm').submit(function (e) {
        e.preventDefault();
        const nodeId = $('#nodeId').val();

        const formData = {
            name: $('#name').val(),
            relation: $('#relation').val(),
            gender: $('#gender').val(),
            dob: $('#dob').val(),
            location: $('#location').val(),
            address: $('#address').val(),
            notes: $('#notes').val(),
            photo: $('#photo').val()
        };

        if (nodeId) {
            const index = treeData.findIndex(n => n.id === nodeId);
            if (index !== -1) treeData[index] = { ...treeData[index], ...formData };
            showToast(`${formData.name} updated!`, 'success');
        } else {
            const newId = generateUUID();

            if (isAddingParent) {
                const child = treeData.find(n => n.id === targetId);
                const newParent = { id: newId, parentId: null, ...formData };
                child.parentId = newId;
                treeData.push(newParent);
            } else if (isAddingSpouse) {
                const partner = treeData.find(n => n.id === targetId);
                const newSpouse = { id: newId, spouseId: targetId, ...formData };
                partner.spouseId = newId;
                treeData.push(newSpouse);
            } else {
                treeData.push({ id: newId, parentId: targetId, ...formData });
            }
            showToast(`${formData.name} added to the tree!`, 'success');
        }
        saveTree();
        renderTree();
        closeModal();
    });

    // ── Delete ──────────────────────────────────────────────────────
    function deleteMember(id) {
        const node = treeData.find(n => n.id === id);
        if (node && node.relation === 'Self') {
            showToast('Cannot delete the main "Me" node!', 'error');
            return;
        }

        const memberName = node ? node.name : 'Member';
        const toDeleteIds = [id];

        let found = true;
        while (found) {
            found = false;
            const currentLen = toDeleteIds.length;
            treeData.forEach(node => {
                if (!toDeleteIds.includes(node.id) && toDeleteIds.includes(node.parentId)) {
                    toDeleteIds.push(node.id);
                }
            });
            if (toDeleteIds.length > currentLen) found = true;
        }

        treeData = treeData.filter(node => !toDeleteIds.includes(node.id));

        // Remove spouse references
        treeData.forEach(node => {
            if (toDeleteIds.includes(node.spouseId)) {
                delete node.spouseId;
            }
        });

        if (treeData.length === 0) {
            loadTree();
        } else {
            saveTree();
            renderTree();
        }
        showToast(`${memberName} removed from the tree`, 'info');
    }

    function deleteSpouseFamily(spouseId) {
        const spouse = treeData.find(n => n.id === spouseId);
        if (!spouse || !spouse.parentId) {
            showToast("No extended family found to unlink.", "warning");
            return;
        }

        const parentIdToCut = spouse.parentId;
        // 1. Sever the link (This insulates the spouse & main tree from the deletion)
        spouse.parentId = null;

        // 2. Build undirected adjacency list for component discovery
        const adj = new Map();
        treeData.forEach(n => adj.set(n.id, []));

        treeData.forEach(n => {
            if (n.parentId) {
                adj.get(n.id).push(n.parentId);
                adj.get(n.parentId).push(n.id);
            }
            if (n.spouseId) {
                adj.get(n.id).push(n.spouseId);
                adj.get(n.spouseId).push(n.id);
            }
        });

        // 3. Find all nodes reachable from the cut parent (the now-orphaned tree)
        let toDeleteIds = [];
        let queue = [parentIdToCut];
        let visited = new Set();

        while (queue.length > 0) {
            const curr = queue.shift();
            if (!visited.has(curr)) {
                visited.add(curr);
                toDeleteIds.push(curr);
                const neighbors = adj.get(curr) || [];
                neighbors.forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        queue.push(neighbor);
                    }
                });
            }
        }

        // 4. Remove all orphaned nodes
        treeData = treeData.filter(node => !toDeleteIds.includes(node.id));

        saveTree();
        renderTree();
        showToast("Spouse's extended family unlinked and deleted.", "info");
    }

    // ── Top-level Actions ───────────────────────────────────────────
    $('#createFamilyBtn').click(function () {
        if (confirm('Create a new independent family tree? This will add a new root node.')) {
            const newId = generateUUID();
            treeData.push({
                id: newId,
                name: "New Family Root",
                relation: "Root",
                gender: "Other",
                parentId: null,
                children: []
            });
            saveTree();
            renderTree();
            showToast('New family created!', 'success');
            openModal(treeData.find(n => n.id === newId), null, false, false);
        }
    });

    $('#logoutBtn').click(function () {
        Auth.logout();
    });

    $('#saveBtn').click(function () {
        saveTree();
        showToast('Tree saved successfully!', 'success');
    });

    $('#importBtn').click(function () {
        $('#importInput').click();
    });

    $('#importInput').change(function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (Array.isArray(importedData)) {
                    treeData = importedData;
                    saveTree();
                    renderTree();
                    showToast('Tree imported successfully!', 'success');
                } else {
                    showToast('Invalid tree data format.', 'error');
                }
            } catch (err) {
                showToast('Error parsing JSON file.', 'error');
            }
            // Reset input so the same file can be selected again if needed
            $('#importInput').val('');
        };
        reader.readAsText(file);
    });

    $('#downloadBtn').click(function () {
        const username = Auth.getCurrentUser().username;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(treeData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `family_tree_${username}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        showToast('Data downloaded!', 'success');
    });

    // Reset Tree (hold Shift + click Save)
    $('#saveBtn').on('dblclick', function () {
        if (confirm('Double-clicked Save. Do you want to RESET the tree? This will delete all data and start fresh.')) {
            localStorage.removeItem(treeKey);
            treeData = [];
            loadTree();
            showToast('Tree has been reset!', 'info');
        }
    });

    // Initialize
    loadTree();

    // Redraw SVG on resize
    $(window).on('resize', drawConnections);

    // ── Drag-to-Pan Canvas Physics ──────────────────────────────────
    function initCanvasPan() {
        const slider = document.querySelector('.tree-container');
        let isDown = false;
        let startX;
        let startY;
        let scrollLeft;
        let scrollTop;

        // Ensure container can scroll beyond strict bounding limits
        slider.style.cursor = 'grab';

        slider.addEventListener('mousedown', (e) => {
            // Prevent panning if user is clicking a button or input field
            if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
            if (e.target.tagName.toLowerCase() === 'input' || e.target.closest('input')) return;
            if (e.target.tagName.toLowerCase() === 'select' || e.target.closest('select')) return;

            isDown = true;
            slider.style.cursor = 'grabbing';
            startX = e.pageX - slider.offsetLeft;
            startY = e.pageY - slider.offsetTop;
            scrollLeft = slider.scrollLeft;
            scrollTop = slider.scrollTop;
        });

        slider.addEventListener('mouseleave', () => {
            isDown = false;
            slider.style.cursor = 'grab';
        });

        slider.addEventListener('mouseup', () => {
            isDown = false;
            slider.style.cursor = 'grab';
        });

        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const y = e.pageY - slider.offsetTop;
            const walkX = (x - startX) * 1.5; // Multiply for pan speed
            const walkY = (y - startY) * 1.5;
            slider.scrollLeft = scrollLeft - walkX;
            slider.scrollTop = scrollTop - walkY;
        });
    }

    initCanvasPan();
});
