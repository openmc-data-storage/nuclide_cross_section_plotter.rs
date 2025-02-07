use std::collections::HashSet;
use yew::{Callback, classes, function_component, Html, html, TargetCast, use_reducer, use_state};
use serde::Serialize;
use web_sys::{console, HtmlInputElement, InputEvent};
use yew_hooks::use_set;
use yew_hooks::use_async;
// use yew_custom_components::pagination::Pagination;
use yew_custom_components::table::{Options, Table};
use yew_custom_components::table::types::{ColumnBuilder, TableData};
use crate::types::mock_data::Entry;

use plotly::{Plot, Scatter};
use plotly::layout::{AxisType};
use yew::prelude::*;
use serde::Deserialize;

#[derive(Debug, Serialize, Deserialize)]
struct ReactionData {
    #[serde(rename = "energy")]
    energy_values: Vec<f64>,
    #[serde(rename = "cross section")]
    cross_section_values: Vec<f64>,
}

#[derive(PartialEq, Clone, Serialize)]
pub struct XsCache {
    pub energy_values: Vec<Vec<f64>>,
    pub cross_section_values: Vec<Vec<f64>>,
    pub checkbox_selected: Vec<bool>,
    pub labels: Vec<String>,
}

#[derive(Properties, PartialEq)]
pub struct PlotProps {
    pub selected_indexes: HashSet<usize>,
}

#[function_component(App)]
pub fn plot_component(props: &PlotProps) -> Html {
    let selected_indexes = &props.selected_indexes;
    let is_y_log = use_state(|| true);
    let is_x_log = use_state(|| true);

    let p = use_async::<_, _, ()>({
        let selected_indexes = selected_indexes.clone();
        let is_y_log = is_y_log.clone();
        let is_x_log = is_x_log.clone();

        async move {
            let cache = generate_cache(&selected_indexes).await;

            let id = "plot-div";
            let mut plot = Plot::new();

            for (i, (energy, cross_section)) in cache.energy_values.iter().zip(&cache.cross_section_values).enumerate() {
                if cache.checkbox_selected[i] {
                    let trace = Scatter::new(energy.clone(), cross_section.clone())
                        .name(&format!("{}", cache.labels[i]));
                    plot.add_trace(trace);
                }
            }

            let y_axis = plotly::layout::Axis::new()
                .title("Cross section [barns]")
                // .show_line(true)
                .zero_line(true)
                // .range(0)  not sure how to set lower value
                .type_(if *is_y_log { AxisType::Log } else { AxisType::Linear });
            
            let x_axis = plotly::layout::Axis::new()
                .title("Energy [eV]")
                .zero_line(true)
                // .show_line(true)
                .type_(if *is_x_log { AxisType::Log } else { AxisType::Linear });

            let layout = plotly::Layout::new()
                // .title("Cross sections plotted with XSPlot.com")
                .show_legend(true)
                .x_axis(x_axis)
                .y_axis(y_axis);
            
            plot.set_layout(layout);

            plotly::bindings::new_plot(id, &plot).await;
            Ok(())
        }
    });

    use_effect_with((selected_indexes.clone(), is_y_log.clone(), is_x_log.clone()), move |_| {
        p.run();
    });

    let onclick_toggle_y_log = {
        let is_y_log = is_y_log.clone();
        Callback::from(move |_| {
            is_y_log.set(!*is_y_log);
        })
    };

    let onclick_toggle_x_log = {
        let is_x_log = is_x_log.clone();
        Callback::from(move |_| {
            is_x_log.set(!*is_x_log);
        })
    };

    html! {
        <div style="text-align: center;">
        <div class="d-flex mb-2">
            <button 
                onclick={onclick_toggle_y_log}
                class="btn btn-primary me-2"
            >
                {if *is_y_log { "Switch Y to Linear Scale" } else { "Switch Y to Log Scale" }}
            </button>
            <button 
                onclick={onclick_toggle_x_log}
                class="btn btn-primary"
            >
                {if *is_x_log { "Switch X to Linear Scale" } else { "Switch X to Log Scale" }}
            </button>
        </div>
        <div id="plot-div"></div>
    </div>
    }
}

async fn generate_cache(selected: &HashSet<usize>) -> XsCache {
    // TODO add name to this so that when adding a trace the name can be set
    let mut cache_energy_values = Vec::new();
    let mut cache_cross_section_values = Vec::new();
    let mut cache_checkbox_selected = Vec::new();
    let mut cache_labels = Vec::new();
    console::log_1(&serde_wasm_bindgen::to_value("selected_id").unwrap());
    for &selected_id in selected.iter() {
        let (energy, cross_section, label) = get_values_by_id(selected_id as i32).await.expect("Failed to get values by ID");
        cache_energy_values.push(energy);
        cache_cross_section_values.push(cross_section);
        cache_checkbox_selected.push(true);
        cache_labels.push(label);
        console::log_1(&selected_id.clone().into());
    }

    XsCache {
        energy_values: cache_energy_values,
        cross_section_values: cache_cross_section_values,
        checkbox_selected: cache_checkbox_selected,
        labels: cache_labels,
    }
}

async fn get_values_by_id(id: i32) -> Result<(Vec<f64>, Vec<f64>, String), reqwest::Error> {
    let data = crate::types::mock_data::Data::default();
    let entry = data.data.iter().find(|entry| entry.id == id).expect("Entry not found");
    let output = convert_string(entry);
    console::log_1(&serde_wasm_bindgen::to_value(&"output").unwrap());
    console::log_1(&serde_wasm_bindgen::to_value(&output).unwrap());
    console::log_1(&serde_wasm_bindgen::to_value(&"entry.library").unwrap());
    console::log_1(&serde_wasm_bindgen::to_value(&entry.library).unwrap());

    let url = match entry.library.as_str() {
        "ENDFB-8.0" => format!("https://raw.githubusercontent.com/openmc-data-storage/ENDF-B-VIII.0-NNDC-json/refs/heads/main/json_files/{output}.json"),
        "FENDL-3.2c" => format!("https://raw.githubusercontent.com/openmc-data-storage/FENDL-3.2c-json/refs/heads/main/FENDL-3.2c_json/{output}.json"),
        _ => panic!("Unsupported library: {}", entry.library),
    };

    console::log_1(&serde_wasm_bindgen::to_value(&url).unwrap());
    let downloaded_reaction_data: ReactionData = reqwest::get(url)
        .await?
        .json()
        .await?;
        console::log_1(&serde_wasm_bindgen::to_value("downloaded data").unwrap());
        console::log_1(&serde_wasm_bindgen::to_value(&downloaded_reaction_data).unwrap());
    
    let label = entry.element.clone() + entry.nucleons.to_string().as_str() + " " + entry.reaction.as_str()+ " " +entry.library.as_str(); //   +" " + entry.temperature.as_str();
    Ok((downloaded_reaction_data.energy_values, downloaded_reaction_data.cross_section_values, label))
}


fn convert_string(entry: &Entry) -> String {
    let element = entry.element.clone();
    let nucleons = entry.nucleons.clone();
    let library = entry.library.clone();
    // let reaction = entry.reaction.clone();  // not needed as we have MT number
    let particle:char = 'n';  // entry.particle.clone();
    let mt = entry.mt.clone();
    let temperature = entry.temperature.clone();
    let output = format!("{}_{}_{}_{}_{}_{}", element, nucleons, library, particle, mt, temperature);
    output
}


#[function_component(Home)]
pub fn home() -> Html {
    let data = use_reducer(crate::types::mock_data::Data::default);
    let mock_data = (*data).clone();

    let element_search_term = use_state(|| None::<String>);
    let nucleons_search_term = use_state(|| None::<String>);
    let reaction_search_term = use_state(|| None::<String>);
    let mt_search_term = use_state(|| None::<String>);
    let library_search_term = use_state(|| None::<String>);
    let element_search = (*element_search_term).as_ref().cloned();
    let nucleons_search = (*nucleons_search_term).as_ref().cloned();
    let reaction_search = (*reaction_search_term).as_ref().cloned();
    let mt_search = (*mt_search_term).as_ref().cloned();
    let library_search = (*library_search_term).as_ref().cloned();

    let page = use_state(|| 0usize);
    let current_page = (*page).clone();

    let selected_indexes = use_set(HashSet::<usize>::new());
    let sum = selected_indexes.current().len();

    let columns = vec![
        ColumnBuilder::new("select").orderable(true).short_name("Select").data_property("select").header_class("user-select-none").build(),
        // ColumnBuilder::new("id").orderable(true).short_name("ID").data_property("id").header_class("user-select-none").build(),
        ColumnBuilder::new("element").orderable(true).short_name("Element").data_property("element").header_class("user-select-none").build(),
        ColumnBuilder::new("nucleons").orderable(true).short_name("Nucleons").data_property("nucleons").header_class("user-select-none").build(),
        ColumnBuilder::new("reaction").orderable(true).short_name("Reaction").data_property("reaction").header_class("user-select-none").build(),
        // ColumnBuilder::new("library").orderable(true).short_name("Library").data_property("library").header_class("user-select-none").build(),
        ColumnBuilder::new("mt").orderable(true).short_name("MT").data_property("mt").header_class("user-select-none").build(),
        ColumnBuilder::new("library").orderable(true).short_name("Library").data_property("library").header_class("user-select-none").build(),
        // ColumnBuilder::new("temperature").orderable(true).short_name("Temperature").data_property("temperature").header_class("user-select-none").build(),
    ];

    let options = Options {
        unordered_class: Some("fa-sort".to_string()),
        ascending_class: Some("fa-sort-up".to_string()),
        descending_class: Some("fa-sort-down".to_string()),
        orderable_classes: vec!["mx-1".to_string(), "fa-solid".to_string()],
    };

    let callback_sum = {
        let selected_indexes = selected_indexes.clone();
        Callback::from(move |index: usize| {
            if !selected_indexes.insert(index) {
                selected_indexes.remove(&index);
            }
        })
    };

    let filtered_data: Vec<TableLine> = mock_data.data
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            let element = &entry.element;
            let nucleons = &entry.nucleons;
            let reaction = &entry.reaction;
            let mt = &entry.mt;
            let library = &entry.library;

            let element_match = match element_search {
                Some(ref term) => element.to_lowercase().contains(&term.to_lowercase()),
                None => true,
            };
            let nucleons_match = match nucleons_search {
                Some(ref term) => nucleons.to_string().contains(&*term),
                None => true,
            };
            let reaction_match = match reaction_search {
                Some(ref term) => reaction.to_lowercase().contains(&term.to_lowercase()),
                None => true,
            };
            let mt_match = match mt_search {
                Some(ref term) => mt.to_string().contains(&*term),
                None => true,
            };
            let library_match = match library_search {
                Some(ref term) => library.to_string().contains(&*term),
                None => true,
            };

            element_match && nucleons_match && reaction_match && mt_match && library_match
        })
        .map(|(index, entry)| TableLine {
            original_index: index,
            id: entry.id,
            element: entry.element.clone(),
            nucleons: entry.nucleons.clone(),
            reaction: entry.reaction.clone(),
            mt: entry.mt.clone(),
            library: entry.library.clone(),
            temperature: entry.temperature.clone(),
            checked: selected_indexes.current().contains(&index),
            sum_callback: callback_sum.clone(),
        })
        .collect();

    let limit = 10;
    let current_page = if filtered_data.is_empty() {
        0
    } else {
        current_page.min((filtered_data.len() - 1) / limit)
    };

    let start_index = current_page * limit;
    let end_index = (start_index + limit).min(filtered_data.len());

    let paginated_data = if filtered_data.is_empty() {
        Vec::new()
    } else {
        filtered_data[start_index..end_index].to_vec()
    };

    // let total = filtered_data.len().max(1);

    let oninput_element_search = {
        let element_search_term = element_search_term.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if input.value().is_empty() {
                element_search_term.set(None);
            } else {
                element_search_term.set(Some(input.value()));
            }
        })
    };

    let oninput_nucleon_search = {
        let nucleons_search_term = nucleons_search_term.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if input.value().is_empty() {
                nucleons_search_term.set(None);
            } else {
                nucleons_search_term.set(Some(input.value()));
            }
        })
    };

    let oninput_reaction_search = {
        let reaction_search_term = reaction_search_term.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if input.value().is_empty() {
                reaction_search_term.set(None);
            } else {
                reaction_search_term.set(Some(input.value()));
            }
        })
    };

    let oninput_mt_search = {
        let mt_search_term = mt_search_term.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if input.value().is_empty() {
                mt_search_term.set(None);
            } else {
                mt_search_term.set(Some(input.value()));
            }
        })
    };

    let oninput_library_search = {
        let library_search_term = library_search_term.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if input.value().is_empty() {
                library_search_term.set(None);
            } else {
                library_search_term.set(Some(input.value()));
            }
        })
    };

    // let pagination_options = yew_custom_components::pagination::Options::default()
    //     .show_prev_next(true)
    //     .show_first_last(true)
    //     .list_classes(vec!(String::from("pagination")))
    //     .item_classes(vec!(String::from("page-item")))
    //     .link_classes(vec!(String::from("page-link")))
    //     .active_item_classes(vec!(String::from("active")))
    //     .disabled_item_classes(vec!(String::from("disabled")));

    // let handle_page = {
    //     let page = page.clone();
    //     Callback::from(move |new_page: usize| {
    //         page.set(new_page);
    //     })
    // };

    html!(
        <>
            <h1>{"Nuclide microscopic cross section plotter"}</h1>


            <div class="d-flex mb-2">
                <div class="flex-grow-1 p-2 input-group me-2">
                    <span class="input-group-text">
                        <i class="fas fa-search"></i>
                    </span>
                    <input 
                        class="form-control" 
                        type="text" 
                        id="element-search" 
                        placeholder="Search by element" 
                        oninput={oninput_element_search} 
                    />
                </div>
                <div class="flex-grow-1 p-2 input-group">
                    <span class="input-group-text">
                        <i class="fas fa-search"></i>
                    </span>
                    <input 
                        class="form-control" 
                        type="text" 
                        id="nucleon-search" 
                        placeholder="Search by nucleons" 
                        oninput={oninput_nucleon_search} 
                    />
                </div>
            </div>
            
            <div class="d-flex mb-2">
                <div class="flex-grow-1 p-2 input-group me-2">
                    <span class="input-group-text">
                        <i class="fas fa-search"></i>
                    </span>
                    <input 
                        class="form-control" 
                        type="text" 
                        id="reaction-search" 
                        placeholder="Search by reaction" 
                        oninput={oninput_reaction_search} 
                    />
                </div>
                <div class="flex-grow-1 p-2 input-group">
                    <span class="input-group-text">
                        <i class="fas fa-search"></i>
                    </span>
                    <input 
                        class="form-control" 
                        type="text" 
                        id="mt-search" 
                        placeholder="Search by MT" 
                        oninput={oninput_mt_search} 
                    />
                </div>
                <div class="flex-grow-1 p-2 input-group">
                    <span class="input-group-text">
                        <i class="fas fa-search"></i>
                    </span>
                    <input 
                        class="form-control" 
                        type="text" 
                        id="library-search" 
                        placeholder="Search by library" 
                        oninput={oninput_library_search} 
                    />
                </div>
            </div>

            
            <div class="d-flex mb-2">
                <div class="flex-grow-1 p-2 input-group me-2">
                <Table<TableLine> 
                    options={options.clone()} 
                    limit={Some(limit)} 
                    page={current_page} 
                    search={element_search.clone()} 
                    classes={classes!("table", "table-hover")} 
                    columns={columns.clone()} 
                    data={paginated_data} 
                    orderable={true}
                />
                <h5>{"Number selected"} <span class="badge text-bg-secondary">{sum}</span></h5>
                </div>
                <div class="flex-grow-1 p-2 input-group">

                // <Pagination 
                //     total={total}
                //     limit={limit} 
                //     max_pages={6} 
                //     options={pagination_options} 
                //     on_page={Some(handle_page)}
                // />
                <div class="flex-grow-1" style="width: 100%;">
                    <App selected_indexes={(*selected_indexes.current()).clone()} />
                </div>
                </div>
                </div>
        </>
    )
}

#[derive(Clone, Serialize, Debug, Default)]
struct TableLine {
    pub original_index: usize,
    pub checked: bool,
    pub id: i32,
    pub element: String,
    pub nucleons: i32,
    pub reaction: String,
    pub mt: i32,
    pub library: String,
    pub temperature: String,
    #[serde(skip_serializing)]
    pub sum_callback: Callback<usize>,
}

impl PartialEq<Self> for TableLine {
    fn eq(&self, other: &Self) -> bool {
        self.element == other.element && self.nucleons == other.nucleons && self.checked == other.checked
    }
}

impl PartialOrd for TableLine {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        self.element.partial_cmp(&other.element)
    }
}

impl TableData for TableLine {
    fn get_field_as_html(&self, field_name: &str) -> yew_custom_components::table::error::Result<Html> {
        match field_name {
            "select" => Ok(html!( <input type="checkbox" style="width: 30px; height: 30px;" checked={self.checked}
                onclick={
                let value = self.original_index;
                let handle_sum = self.sum_callback.clone();
                move |_| { handle_sum.emit(value); }
                } /> )
            ),
            "id" => Ok(html! { self.id }),
            "element" => Ok(html! { self.element.clone() }),
            "nucleons" => Ok(html! { self.nucleons }),
            "library" => Ok(html! { self.library.clone() }),
            "reaction" => Ok(html! { self.reaction.clone() }),
            "mt" => Ok(html! { self.mt }),
            _ => Ok(html! {}),
        }
    }

    fn get_field_as_value(&self, field_name: &str) -> yew_custom_components::table::error::Result<serde_value::Value> {
        match field_name {
            "id" => Ok(serde_value::Value::I32(self.id)),
            "element" => Ok(serde_value::Value::String(self.element.clone())),
            "nucleons" => Ok(serde_value::Value::I32(self.nucleons)),
            "library" => Ok(serde_value::Value::String(self.library.clone())),
            "reaction" => Ok(serde_value::Value::String(self.reaction.clone())),
            "mt" => Ok(serde_value::Value::I32(self.mt)),
            "select" => Ok(serde_value::Value::Bool(self.checked)),
            _ => Ok(serde_value::to_value(()).unwrap()),
        }
    }

    fn matches_search(&self, needle: Option<String>) -> bool {
        match needle {
            Some(needle) => self.element.to_lowercase().contains(&needle.to_lowercase()),
            None => true,
        }
    }
}