// Physical work-area coordinates only; this module never resizes windows.
pub(super) fn clamp(
    area: [i32; 4],
    size: (i32, i32),
    position: (i32, i32),
    margin: i32,
) -> (i32, i32) {
    let [left, top, right, bottom] = area;
    let mx = margin.min((right - left - size.0).max(0) / 2).max(0);
    let my = margin.min((bottom - top - size.1).max(0) / 2).max(0);
    (
        position
            .0
            .clamp(left + mx, (right - size.0 - mx).max(left + mx)),
        position
            .1
            .clamp(top + my, (bottom - size.1 - my).max(top + my)),
    )
}

pub(super) fn arrange(
    area: [i32; 4],
    anchor: &str,
    sizes: &[(i32, i32)],
    gap: i32,
    margin: i32,
    overlap: bool,
    header_height: i32,
) -> (Vec<(i32, i32)>, bool) {
    if sizes.is_empty() {
        return (Vec::new(), false);
    }
    let [left, top, right, bottom] = area;
    let max_width = sizes.iter().map(|s| s.0).max().unwrap();
    let max_height = sizes.iter().map(|s| s.1).max().unwrap();
    let mx = margin.min((right - left - max_width).max(0) / 2).max(0);
    let my = margin.min((bottom - top - max_height).max(0) / 2).max(0);
    let available_height = bottom - top - my * 2;
    let from_left = anchor.ends_with("left");
    let from_top = anchor.starts_with("top");
    if !overlap {
        let mut columns: Vec<Vec<usize>> = vec![Vec::new()];
        let mut used_height = 0;
        for (index, &(_, height)) in sizes.iter().enumerate() {
            let extra = if columns.last().unwrap().is_empty() {
                0
            } else {
                gap
            };
            if used_height + extra + height > available_height
                && !columns.last().unwrap().is_empty()
            {
                columns.push(Vec::new());
                used_height = 0;
            }
            if !columns.last().unwrap().is_empty() {
                used_height += gap;
            }
            columns.last_mut().unwrap().push(index);
            used_height += height;
        }
        let widths: Vec<_> = columns
            .iter()
            .map(|column| column.iter().map(|&i| sizes[i].0).max().unwrap())
            .collect();
        let total_width: i64 =
            widths.iter().map(|&w| w as i64).sum::<i64>() + gap as i64 * (columns.len() - 1) as i64;
        if max_height <= available_height && total_width <= (right - left - mx * 2) as i64 {
            let mut result = vec![(0, 0); sizes.len()];
            let mut horizontal = 0;
            for (column, width) in columns.iter().zip(widths) {
                let mut vertical = 0;
                for &i in column {
                    let (w, h) = sizes[i];
                    let x = if from_left {
                        left + mx + horizontal
                    } else {
                        right - mx - horizontal - w
                    };
                    let y = if from_top {
                        top + my + vertical
                    } else {
                        bottom - my - vertical - h
                    };
                    result[i] = (x, y);
                    vertical += h + gap;
                }
                horizontal += width + gap;
            }
            return (result, false);
        }
    }
    // Compress exposed headers only when a full header per card cannot fit.
    let room = (available_height - max_height).max(0);
    let span = ((sizes.len() - 1) as i64 * header_height as i64).min(room as i64);
    let base_y = if from_top {
        top + my
    } else {
        bottom - my - max_height - span as i32
    };
    let result = sizes
        .iter()
        .enumerate()
        .map(|(i, &(w, h))| {
            let offset = if sizes.len() > 1 {
                span * i as i64 / (sizes.len() - 1) as i64
            } else {
                0
            };
            let x = if from_left { left + mx } else { right - mx - w };
            clamp(area, (w, h), (x, base_y + offset as i32), margin)
        })
        .collect();
    (result, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn four_corners_fill_vertically_then_inward() {
        for anchor in ["top-left", "top-right", "bottom-left", "bottom-right"] {
            let (p, stacked) = arrange(
                [0, 0, 1000, 700],
                anchor,
                &[(300, 260); 4],
                12,
                20,
                false,
                48,
            );
            assert!(!stacked);
            let direction = if anchor.starts_with("top") { 1 } else { -1 };
            assert_eq!(p[1].1 - p[0].1, direction * 272);
            assert_eq!(p[2].1, p[0].1);
            assert_eq!(
                p[2].0 - p[0].0,
                if anchor.ends_with("left") { 312 } else { -312 }
            );
        }
    }
    #[test]
    fn actual_mixed_sizes_control_column_width_and_row_height() {
        let (p, stacked) = arrange(
            [-1200, -100, 0, 700],
            "bottom-right",
            &[(300, 270), (400, 350), (250, 240)],
            10,
            20,
            false,
            48,
        );
        assert!(!stacked);
        assert_eq!(p, vec![(-320, 410), (-420, 50), (-680, 440)]);
    }
    #[test]
    fn overflow_falls_back_to_newest_in_front_header_stack() {
        for mode in [false, true] {
            let (p, stacked) = arrange(
                [0, 0, 450, 700],
                "bottom-right",
                &[(396, 300); 5],
                12,
                20,
                mode,
                48,
            );
            assert!(stacked);
            for pair in p.windows(2) {
                assert_eq!(pair[1].1 - pair[0].1, 48);
            }
            assert_eq!(p[4], (34, 380));
        }
    }
    #[test]
    fn no_overlap_when_columns_fit_and_no_outside_when_stacking() {
        for anchor in ["top-left", "top-right", "bottom-left", "bottom-right"] {
            for n in 1..80 {
                let sizes: Vec<_> = (0..n)
                    .map(|i| (300 + (i % 3) * 20, 220 + (i % 4) * 30))
                    .collect();
                let (p, stacked) =
                    arrange([-1600, -200, 0, 800], anchor, &sizes, 12, 20, false, 48);
                for (i, &(x, y)) in p.iter().enumerate() {
                    assert!(
                        x >= -1580 && y >= -180 && x + sizes[i].0 <= -20 && y + sizes[i].1 <= 780
                    );
                    if !stacked {
                        for j in 0..i {
                            let (a, b) = p[j];
                            assert!(
                                x >= a + sizes[j].0 + 12
                                    || a >= x + sizes[i].0 + 12
                                    || y >= b + sizes[j].1 + 12
                                    || b >= y + sizes[i].1 + 12
                            );
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn tiny_area_preserves_size_and_anchors_oversized_card_without_panicking() {
        let (p, stacked) = arrange(
            [0, 0, 300, 200],
            "bottom-right",
            &[(500, 430)],
            64,
            120,
            false,
            48,
        );
        assert!(stacked);
        assert_eq!(p, vec![(0, 0)]);
        assert_eq!(clamp([0, 0, 500, 400], (480, 390), (-20, 90), 120), (10, 5));
        assert!(
            arrange([0, 0, 100, 100], "top-left", &[], 12, 20, false, 48)
                .0
                .is_empty()
        );
    }
}
