--
-- PostgreSQL database dump
--

\restrict I4KowjYlRu55SDPgZQA7a7SZIqKRJo6sXsubNmn9LXVs5Ccsi9co01wLjuPzhWk

-- Dumped from database version 12.22 (Ubuntu 12.22-0ubuntu0.20.04.4)
-- Dumped by pg_dump version 12.22 (Ubuntu 12.22-0ubuntu0.20.04.4)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_table_access_method = heap;

--
-- Name: add_on_base_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.add_on_base_products (
    id bigint NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    add_on_id bigint NOT NULL,
    base_product_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    asset_info_id bigint
);


--
-- Name: add_on_base_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.add_on_base_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: add_on_base_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.add_on_base_products_id_seq OWNED BY public.add_on_base_products.id;


--
-- Name: add_on_colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.add_on_colors (
    id bigint NOT NULL,
    add_on_id bigint NOT NULL,
    color_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL
);


--
-- Name: add_on_colors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.add_on_colors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: add_on_colors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.add_on_colors_id_seq OWNED BY public.add_on_colors.id;


--
-- Name: add_on_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.add_on_parts (
    id bigint NOT NULL,
    add_on_id bigint NOT NULL,
    part_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    asset_info_id bigint
);


--
-- Name: add_on_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.add_on_parts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: add_on_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.add_on_parts_id_seq OWNED BY public.add_on_parts.id;


--
-- Name: add_ons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.add_ons (
    id bigint NOT NULL,
    airtable_id character varying,
    add_on character varying,
    add_on_price numeric,
    add_on_of numeric,
    add_on_sn numeric,
    has_color boolean NOT NULL,
    select_type integer,
    group_name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false,
    image character varying,
    "position" integer DEFAULT 0 NOT NULL,
    layer_sort integer DEFAULT 0,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: add_ons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.add_ons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: add_ons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.add_ons_id_seq OWNED BY public.add_ons.id;


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id bigint NOT NULL,
    address character varying,
    state character varying,
    city character varying,
    zip_code character varying,
    is_primary boolean DEFAULT false NOT NULL,
    deleted_at timestamp(6) without time zone DEFAULT NULL::timestamp without time zone,
    user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: addresses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.addresses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: addresses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.addresses_id_seq OWNED BY public.addresses.id;


--
-- Name: app_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_configs (
    id bigint NOT NULL,
    version character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: app_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_configs_id_seq OWNED BY public.app_configs.id;


--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: asset_infos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_infos (
    id bigint NOT NULL,
    "dX" numeric,
    "dY" numeric,
    "mirrorDX" numeric,
    "assetHeightRespToBox" numeric,
    asset character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: asset_infos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.asset_infos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: asset_infos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.asset_infos_id_seq OWNED BY public.asset_infos.id;


--
-- Name: assigned_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assigned_brands (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    authorized_brand_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: assigned_brands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assigned_brands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assigned_brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assigned_brands_id_seq OWNED BY public.assigned_brands.id;


--
-- Name: authorized_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authorized_brands (
    id bigint NOT NULL,
    name character varying,
    is_deleted boolean DEFAULT false,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source integer DEFAULT 0 NOT NULL,
    description character varying,
    logo character varying,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: authorized_brands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.authorized_brands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: authorized_brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.authorized_brands_id_seq OWNED BY public.authorized_brands.id;


--
-- Name: back_order_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.back_order_links (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    back_order_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: back_order_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.back_order_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: back_order_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.back_order_links_id_seq OWNED BY public.back_order_links.id;


--
-- Name: base_product_asset_infos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_product_asset_infos (
    id bigint NOT NULL,
    add_on_id bigint NOT NULL,
    part_id bigint NOT NULL,
    asset_info_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    base_product_id bigint NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: base_product_asset_infos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_product_asset_infos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_product_asset_infos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_product_asset_infos_id_seq OWNED BY public.base_product_asset_infos.id;


--
-- Name: base_product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_product_categories (
    id bigint NOT NULL,
    base_product_id bigint NOT NULL,
    category_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL
);


--
-- Name: base_product_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_product_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_product_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_product_categories_id_seq OWNED BY public.base_product_categories.id;


--
-- Name: base_product_fabrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_product_fabrics (
    id bigint NOT NULL,
    base_product_id bigint NOT NULL,
    fabric_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL
);


--
-- Name: base_product_fabrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_product_fabrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_product_fabrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_product_fabrics_id_seq OWNED BY public.base_product_fabrics.id;


--
-- Name: base_product_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_product_parts (
    id bigint NOT NULL,
    base_product_id bigint NOT NULL,
    part_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL
);


--
-- Name: base_product_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_product_parts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_product_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_product_parts_id_seq OWNED BY public.base_product_parts.id;


--
-- Name: base_product_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_product_types (
    id bigint NOT NULL,
    name character varying,
    image character varying,
    "position" integer DEFAULT 0,
    is_deleted boolean DEFAULT false,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: base_product_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_product_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_product_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_product_types_id_seq OWNED BY public.base_product_types.id;


--
-- Name: base_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_products (
    id bigint NOT NULL,
    airtable_id character varying,
    name character varying,
    base_of numeric,
    base_sn numeric,
    tims_cost numeric,
    adult_consumption numeric,
    kids_consumption numeric,
    over_header_percentage numeric,
    sample_rate numeric,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false,
    image character varying,
    "position" integer DEFAULT 0 NOT NULL,
    asset_info_id bigint,
    calculator numeric,
    size_type_id integer,
    branding_sides character varying,
    base_product_type_id integer,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: base_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_products_id_seq OWNED BY public.base_products.id;


--
-- Name: base_size_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.base_size_types (
    id bigint NOT NULL,
    base_product_id bigint NOT NULL,
    size_type_id bigint NOT NULL,
    is_deleted boolean DEFAULT false,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: base_size_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.base_size_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: base_size_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.base_size_types_id_seq OWNED BY public.base_size_types.id;


--
-- Name: brandings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brandings (
    id bigint NOT NULL,
    image character varying,
    comment text,
    print_side character varying,
    print_area character varying,
    branding_type integer,
    graphic_dimension character varying,
    product_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    graphic_width numeric DEFAULT 0.0 NOT NULL,
    graphic_height numeric DEFAULT 0.0 NOT NULL,
    graphic_unit character varying DEFAULT ''::character varying NOT NULL,
    item_id bigint,
    mockup_image character varying,
    attachment character varying,
    parent_id bigint
);


--
-- Name: brandings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.brandings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: brandings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.brandings_id_seq OWNED BY public.brandings.id;


--
-- Name: bulk_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bulk_uploads (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    file character varying,
    status integer DEFAULT 0,
    upload_type integer DEFAULT 0,
    total integer DEFAULT 0,
    inserted integer DEFAULT 0,
    updated integer DEFAULT 0,
    skipped integer DEFAULT 0,
    duplicates integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    error_details jsonb DEFAULT '[]'::jsonb,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: bulk_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bulk_uploads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bulk_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bulk_uploads_id_seq OWNED BY public.bulk_uploads.id;


--
-- Name: catalogues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalogues (
    id bigint NOT NULL,
    url character varying,
    params text,
    status integer DEFAULT 0 NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_expired boolean DEFAULT false
);


--
-- Name: catalogues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.catalogues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: catalogues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.catalogues_id_seq OWNED BY public.catalogues.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id bigint NOT NULL,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id bigint NOT NULL,
    name character varying,
    zone_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: cities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cities_id_seq OWNED BY public.cities.id;


--
-- Name: colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.colors (
    id bigint NOT NULL,
    airtable_id character varying,
    name character varying,
    hex_code character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false,
    created_by_id bigint,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: colors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.colors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: colors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.colors_id_seq OWNED BY public.colors.id;


--
-- Name: criteria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.criteria (
    id bigint NOT NULL,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: criteria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.criteria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: criteria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.criteria_id_seq OWNED BY public.criteria.id;


--
-- Name: customer_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_requests (
    id bigint NOT NULL,
    request_type integer DEFAULT 0,
    user_id bigint NOT NULL,
    status integer DEFAULT 0,
    requested_sc_id integer,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: customer_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_requests_id_seq OWNED BY public.customer_requests.id;


--
-- Name: dispatched_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatched_quantities (
    id bigint NOT NULL,
    dispatched_quantity integer DEFAULT 0 NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    job_sheet_dispatched_date_id bigint NOT NULL,
    quantity_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: dispatched_quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispatched_quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispatched_quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispatched_quantities_id_seq OWNED BY public.dispatched_quantities.id;


--
-- Name: extra_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extra_quantities (
    id bigint NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    size_id bigint NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: extra_quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.extra_quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: extra_quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.extra_quantities_id_seq OWNED BY public.extra_quantities.id;


--
-- Name: fabric_colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fabric_colors (
    id bigint NOT NULL,
    fabric_id bigint NOT NULL,
    color_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL
);


--
-- Name: fabric_colors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fabric_colors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fabric_colors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fabric_colors_id_seq OWNED BY public.fabric_colors.id;


--
-- Name: fabrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fabrics (
    id bigint NOT NULL,
    airtable_id character varying,
    name character varying,
    fabric_type integer,
    price numeric,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false,
    uom character varying DEFAULT ''::character varying NOT NULL,
    image character varying,
    gsm numeric,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: fabrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fabrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fabrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fabrics_id_seq OWNED BY public.fabrics.id;


--
-- Name: factories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factories (
    id bigint NOT NULL,
    name character varying,
    deleted_at character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: factories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.factories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: factories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.factories_id_seq OWNED BY public.factories.id;


--
-- Name: item_criteria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_criteria (
    id bigint NOT NULL,
    item_id bigint NOT NULL,
    criteria_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_checked boolean DEFAULT false NOT NULL,
    checked_by_id bigint,
    unchecked_by_id bigint,
    updated_by_id bigint
);


--
-- Name: item_criteria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_criteria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_criteria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_criteria_id_seq OWNED BY public.item_criteria.id;


--
-- Name: item_tailor_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_tailor_quantities (
    id bigint NOT NULL,
    assigned_quantity integer DEFAULT 0 NOT NULL,
    completed_quantity integer DEFAULT 0 NOT NULL,
    item_tailor_id bigint NOT NULL,
    quantity_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    completed_quantity_status integer DEFAULT 0 NOT NULL
);


--
-- Name: item_tailor_quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_tailor_quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_tailor_quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_tailor_quantities_id_seq OWNED BY public.item_tailor_quantities.id;


--
-- Name: item_tailors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_tailors (
    id bigint NOT NULL,
    item_id bigint NOT NULL,
    tailor_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    assigned_quantity integer DEFAULT 0 NOT NULL,
    completed_quantity integer DEFAULT 0 NOT NULL,
    completed_quantity_status integer DEFAULT 0 NOT NULL,
    quantity_completed_at timestamp(6) without time zone
);


--
-- Name: item_tailors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_tailors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_tailors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_tailors_id_seq OWNED BY public.item_tailors.id;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id bigint NOT NULL,
    comment text,
    sample_order boolean,
    product_id bigint,
    order_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    total_amount numeric DEFAULT 0.0 NOT NULL,
    total_quantity integer DEFAULT 0 NOT NULL,
    sample_total_amount numeric DEFAULT 0.0 NOT NULL,
    weight_per_piece numeric DEFAULT 0.0 NOT NULL,
    total_weight numeric DEFAULT 0.0 NOT NULL,
    per_piece_amount numeric DEFAULT 0.0 NOT NULL,
    branding_amount numeric DEFAULT 0.0 NOT NULL,
    cutting_status integer DEFAULT 0 NOT NULL,
    cutting_done integer DEFAULT 0 NOT NULL,
    job_sheet_assigned boolean DEFAULT false NOT NULL,
    job_sheet_due_on timestamp(6) without time zone,
    job_sheet_completion_by timestamp(6) without time zone,
    sample_cutting_done integer DEFAULT 0 NOT NULL,
    sample_cutting_status integer DEFAULT 0 NOT NULL,
    assigned_to_tailor_quantity integer DEFAULT 0 NOT NULL,
    completed_by_tailor_quantity integer DEFAULT 0 NOT NULL,
    completed_by_tailor_quantity_status integer DEFAULT 0 NOT NULL,
    tailor_job_status integer DEFAULT 0 NOT NULL,
    dispatched_quantity integer DEFAULT 0 NOT NULL,
    dispatched_status integer DEFAULT 0 NOT NULL,
    sgst_amount numeric DEFAULT 0.0 NOT NULL,
    cgst_amount numeric DEFAULT 0.0 NOT NULL,
    igst_amount numeric DEFAULT 0.0 NOT NULL,
    rmp_class_id bigint,
    rmp_brand_id bigint,
    item_type integer DEFAULT 0 NOT NULL,
    uc_order_status character varying DEFAULT ''::character varying NOT NULL,
    cutting_master_id bigint,
    airtable_order_report_id character varying,
    add_on_cost numeric DEFAULT 0.0 NOT NULL,
    rmp_category_id bigint,
    calculated_per_piece_amount numeric DEFAULT 0.0 NOT NULL,
    worker_per_piece_amount numeric,
    worker_total_amount numeric,
    job_worker_status integer,
    status_change_time timestamp(6) without time zone,
    rmp_override_price numeric DEFAULT 0.0,
    size_type character varying
);


--
-- Name: items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.items_id_seq OWNED BY public.items.id;


--
-- Name: job_sheet_assign_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sheet_assign_dates (
    id bigint NOT NULL,
    assign_at timestamp(6) without time zone,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: job_sheet_assign_dates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_sheet_assign_dates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_sheet_assign_dates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_sheet_assign_dates_id_seq OWNED BY public.job_sheet_assign_dates.id;


--
-- Name: job_sheet_assign_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sheet_assign_quantities (
    id bigint NOT NULL,
    qty integer NOT NULL,
    assigned_quantity integer NOT NULL,
    completed_quantity integer NOT NULL,
    job_sheet_assign_date_id bigint NOT NULL,
    item_tailor_id bigint NOT NULL,
    quantity_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    job_sheet_assign_tailor_id bigint NOT NULL,
    completed_quantity_status integer DEFAULT 0 NOT NULL,
    item_id bigint NOT NULL
);


--
-- Name: job_sheet_assign_quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_sheet_assign_quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_sheet_assign_quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_sheet_assign_quantities_id_seq OWNED BY public.job_sheet_assign_quantities.id;


--
-- Name: job_sheet_assign_tailors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sheet_assign_tailors (
    id bigint NOT NULL,
    job_sheet_assign_date_id bigint NOT NULL,
    item_tailor_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: job_sheet_assign_tailors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_sheet_assign_tailors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_sheet_assign_tailors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_sheet_assign_tailors_id_seq OWNED BY public.job_sheet_assign_tailors.id;


--
-- Name: job_sheet_dispatched_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sheet_dispatched_dates (
    id bigint NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    dispatched_at timestamp(6) without time zone
);


--
-- Name: job_sheet_dispatched_dates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_sheet_dispatched_dates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_sheet_dispatched_dates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_sheet_dispatched_dates_id_seq OWNED BY public.job_sheet_dispatched_dates.id;


--
-- Name: job_sheet_mark_tailors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sheet_mark_tailors (
    id bigint NOT NULL,
    job_sheet_tailor_mark_date_id bigint NOT NULL,
    item_tailor_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    airtable_tailor_report_id character varying
);


--
-- Name: job_sheet_mark_tailors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_sheet_mark_tailors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_sheet_mark_tailors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_sheet_mark_tailors_id_seq OWNED BY public.job_sheet_mark_tailors.id;


--
-- Name: job_sheet_tailor_mark_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_sheet_tailor_mark_dates (
    id bigint NOT NULL,
    marked_at timestamp(6) without time zone,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: job_sheet_tailor_mark_dates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_sheet_tailor_mark_dates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_sheet_tailor_mark_dates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_sheet_tailor_mark_dates_id_seq OWNED BY public.job_sheet_tailor_mark_dates.id;


--
-- Name: mark_cutting_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mark_cutting_quantities (
    id bigint NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    cutting_done integer DEFAULT 0 NOT NULL,
    quantity_id bigint NOT NULL,
    mark_cutting_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: mark_cutting_quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mark_cutting_quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mark_cutting_quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mark_cutting_quantities_id_seq OWNED BY public.mark_cutting_quantities.id;


--
-- Name: mark_cuttings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mark_cuttings (
    id bigint NOT NULL,
    cutting_date timestamp(6) without time zone,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: mark_cuttings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mark_cuttings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mark_cuttings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mark_cuttings_id_seq OWNED BY public.mark_cuttings.id;


--
-- Name: mark_tailor_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mark_tailor_quantities (
    id bigint NOT NULL,
    completed_quantity integer DEFAULT 0 NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    job_sheet_mark_tailor_id bigint NOT NULL,
    item_tailor_quantity_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: mark_tailor_quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mark_tailor_quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mark_tailor_quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mark_tailor_quantities_id_seq OWNED BY public.mark_tailor_quantities.id;


--
-- Name: milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestones (
    id bigint NOT NULL,
    start_date timestamp(6) without time zone,
    end_date timestamp(6) without time zone,
    milestone_amount numeric,
    order_placed_amount numeric,
    order_completed_amount numeric,
    user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    name character varying DEFAULT ''::character varying NOT NULL
);


--
-- Name: milestones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.milestones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: milestones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.milestones_id_seq OWNED BY public.milestones.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    notification_type integer NOT NULL,
    status integer NOT NULL,
    recipient_id bigint NOT NULL,
    order_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    job_sheet_dispatched_date_id bigint,
    user_id integer,
    title character varying,
    body character varying
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id bigint NOT NULL,
    status integer,
    comment text,
    created_on timestamp(6) without time zone,
    due_on timestamp(6) without time zone,
    customer_id bigint NOT NULL,
    address_id bigint NOT NULL,
    assigned_to_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    total_amount numeric DEFAULT 0.0 NOT NULL,
    branding_amount numeric DEFAULT 0.0 NOT NULL,
    sub_total_amount numeric DEFAULT 0.0 NOT NULL,
    cgst_amount numeric DEFAULT 0.0 NOT NULL,
    igst_amount numeric DEFAULT 0.0 NOT NULL,
    total_quantity integer DEFAULT 0 NOT NULL,
    created_by_id bigint,
    cutting_status integer DEFAULT 0 NOT NULL,
    cutting_done integer DEFAULT 0 NOT NULL,
    completed_by_tailor_quantity_status integer DEFAULT 0 NOT NULL,
    completed_by_tailor_quantity integer DEFAULT 0 NOT NULL,
    assigned_to_tailor_quantity integer DEFAULT 0 NOT NULL,
    tailor_job_status integer DEFAULT 0 NOT NULL,
    dispatched_quantity integer DEFAULT 0 NOT NULL,
    dispatched_status integer DEFAULT 0 NOT NULL,
    assigned_by_id bigint,
    delivered_on timestamp(6) without time zone,
    criteria_status integer DEFAULT 0 NOT NULL,
    sgst_amount numeric DEFAULT 0.0 NOT NULL,
    uc_order_id character varying,
    uc_status character varying DEFAULT ''::character varying NOT NULL,
    due_time timestamp(6) without time zone,
    branding_igst numeric DEFAULT 0.0 NOT NULL,
    branding_cgst numeric DEFAULT 0.0 NOT NULL,
    branding_sgst numeric DEFAULT 0.0 NOT NULL,
    customer_sc_id bigint,
    customer_dealer_id bigint,
    order_item_type integer DEFAULT 0 NOT NULL,
    back_order_for_id bigint,
    payment_status integer DEFAULT 0 NOT NULL,
    is_prime boolean DEFAULT false NOT NULL,
    last_dispatched_at timestamp(6) without time zone,
    dispatch_to integer DEFAULT 0 NOT NULL,
    job_worker_reason character varying,
    assigned_worker_id integer,
    paid_amount numeric DEFAULT 0.0,
    diff_in_days character varying,
    worker_status integer DEFAULT 0,
    deleted_at timestamp(6) without time zone,
    is_deleted boolean DEFAULT false,
    is_force_update boolean DEFAULT false,
    is_updated boolean DEFAULT false
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: part_colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_colors (
    id bigint NOT NULL,
    part_id bigint NOT NULL,
    color_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL
);


--
-- Name: part_colors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_colors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: part_colors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_colors_id_seq OWNED BY public.part_colors.id;


--
-- Name: parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts (
    id bigint NOT NULL,
    airtable_id character varying,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false,
    order_criteria boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parts_id_seq OWNED BY public.parts.id;


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id bigint NOT NULL,
    image character varying,
    comment text,
    product_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: product_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_images_id_seq OWNED BY public.product_images.id;


--
-- Name: product_part_add_ons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_part_add_ons (
    id bigint NOT NULL,
    product_part_id bigint NOT NULL,
    add_on_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    add_on_color_id bigint
);


--
-- Name: product_part_add_ons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_part_add_ons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_part_add_ons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_part_add_ons_id_seq OWNED BY public.product_part_add_ons.id;


--
-- Name: product_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_parts (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    part_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    part_color_id bigint
);


--
-- Name: product_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_parts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_parts_id_seq OWNED BY public.product_parts.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id bigint NOT NULL,
    product_type integer NOT NULL,
    style_number character varying,
    name character varying,
    comment text,
    images json,
    base_product_id bigint,
    fabric_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    branding_enabled boolean,
    category_id bigint,
    created_by_id bigint,
    copy_fabric_color_id bigint,
    fabric_color_id bigint
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: profit_margins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_margins (
    id bigint NOT NULL,
    airtable_id character varying,
    name character varying,
    min_range bigint,
    max_range bigint,
    margin_percentage numeric,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false,
    branding_embroidery numeric DEFAULT 0.0 NOT NULL,
    branding_print numeric DEFAULT 0.0 NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: profit_margins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.profit_margins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: profit_margins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.profit_margins_id_seq OWNED BY public.profit_margins.id;


--
-- Name: promotional_banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotional_banners (
    id bigint NOT NULL,
    title character varying,
    status character varying,
    "position" integer,
    is_deleted boolean DEFAULT false,
    image character varying,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    rmp_category_id integer,
    rmp_brand_id integer,
    rmp_class_id integer,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: promotional_banners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.promotional_banners_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promotional_banners_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.promotional_banners_id_seq OWNED BY public.promotional_banners.id;


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id bigint NOT NULL,
    name character varying,
    upload_date date,
    thumbnail character varying,
    link text,
    file_size character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    category character varying,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: promotions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.promotions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promotions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.promotions_id_seq OWNED BY public.promotions.id;


--
-- Name: quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quantities (
    id bigint NOT NULL,
    quantity integer,
    size_id bigint NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    cutting_done integer DEFAULT 0 NOT NULL,
    assigned_to_tailor_quantity integer DEFAULT 0 NOT NULL,
    completed_by_tailor_quantity integer DEFAULT 0 NOT NULL,
    completed_by_tailor_quantity_status integer DEFAULT 0 NOT NULL,
    dispatched_quantity integer DEFAULT 0 NOT NULL,
    cgst numeric DEFAULT 0.0 NOT NULL,
    igst numeric DEFAULT 0.0 NOT NULL,
    sgst numeric DEFAULT 0.0 NOT NULL
);


--
-- Name: quantities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quantities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quantities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quantities_id_seq OWNED BY public.quantities.id;


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    id bigint NOT NULL,
    rating numeric,
    from_role character varying,
    to_role character varying,
    from_id bigint NOT NULL,
    to_id bigint NOT NULL,
    rating_on_type character varying NOT NULL,
    rating_on_id bigint NOT NULL,
    positive_comments text,
    negative_comments text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: ratings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ratings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ratings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ratings_id_seq OWNED BY public.ratings.id;


--
-- Name: reset_password_histories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reset_password_histories (
    id bigint NOT NULL,
    changed_by_id bigint NOT NULL,
    changed_of_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: reset_password_histories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reset_password_histories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reset_password_histories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reset_password_histories_id_seq OWNED BY public.reset_password_histories.id;


--
-- Name: responsibilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.responsibilities (
    id bigint NOT NULL,
    note character varying,
    responsibility_type integer,
    user_id bigint NOT NULL,
    is_completed boolean DEFAULT false,
    created_by_id integer,
    user_role integer,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: responsibilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.responsibilities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: responsibilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.responsibilities_id_seq OWNED BY public.responsibilities.id;


--
-- Name: rmp_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_brands (
    id bigint NOT NULL,
    name character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    main_category character varying,
    authorized_brand_id integer,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_brands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_brands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_brands_id_seq OWNED BY public.rmp_brands.id;


--
-- Name: rmp_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_categories (
    id bigint NOT NULL,
    name character varying,
    image character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_categories_id_seq OWNED BY public.rmp_categories.id;


--
-- Name: rmp_category_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_category_brands (
    id bigint NOT NULL,
    rmp_category_id bigint NOT NULL,
    rmp_brand_id bigint NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: rmp_category_brands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_category_brands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_category_brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_category_brands_id_seq OWNED BY public.rmp_category_brands.id;


--
-- Name: rmp_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_classes (
    id bigint NOT NULL,
    name character varying,
    airtable_id character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    image_1 character varying,
    image_2 character varying,
    image_3 character varying,
    image_4 character varying,
    image_5 character varying,
    rmp_color_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    embeded_video character varying,
    min_price character varying DEFAULT 0.0,
    min_mrp character varying DEFAULT ''::character varying NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    image_1_thumb character varying,
    image_2_thumb character varying,
    image_3_thumb character varying,
    image_4_thumb character varying,
    image_5_thumb character varying,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_classes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_classes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_classes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_classes_id_seq OWNED BY public.rmp_classes.id;


--
-- Name: rmp_colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_colors (
    id bigint NOT NULL,
    name character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    code character varying,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_colors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_colors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_colors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_colors_id_seq OWNED BY public.rmp_colors.id;


--
-- Name: rmp_min_infos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_min_infos (
    id bigint NOT NULL,
    price character varying,
    mrp character varying,
    rmp_class_id bigint NOT NULL,
    rmp_price_type_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: rmp_min_infos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_min_infos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_min_infos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_min_infos_id_seq OWNED BY public.rmp_min_infos.id;


--
-- Name: rmp_price_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_price_types (
    id bigint NOT NULL,
    name character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    price_for integer DEFAULT 0 NOT NULL,
    zone_id bigint,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_price_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_price_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_price_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_price_types_id_seq OWNED BY public.rmp_price_types.id;


--
-- Name: rmp_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_prices (
    id bigint NOT NULL,
    name character varying,
    price numeric DEFAULT 0.0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    rmp_sku_id bigint NOT NULL,
    rmp_price_type_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    mrp numeric DEFAULT 0.0 NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_prices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_prices_id_seq OWNED BY public.rmp_prices.id;


--
-- Name: rmp_sizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_sizes (
    id bigint NOT NULL,
    name character varying,
    airtable_id character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    size_type integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_sizes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_sizes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_sizes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_sizes_id_seq OWNED BY public.rmp_sizes.id;


--
-- Name: rmp_sku_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_sku_prices (
    id bigint NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    rmp_sku_id bigint NOT NULL,
    rmp_price_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_sku_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_sku_prices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_sku_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_sku_prices_id_seq OWNED BY public.rmp_sku_prices.id;


--
-- Name: rmp_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rmp_skus (
    id bigint NOT NULL,
    name character varying,
    is_deleted boolean DEFAULT false NOT NULL,
    airtable_id character varying,
    rmp_size_id bigint NOT NULL,
    rmp_class_id bigint NOT NULL,
    rmp_brand_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    rmp_category_id bigint,
    cgst numeric DEFAULT 0.0 NOT NULL,
    igst numeric DEFAULT 0.0 NOT NULL,
    sgst numeric DEFAULT 0.0 NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: rmp_skus_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rmp_skus_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rmp_skus_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rmp_skus_id_seq OWNED BY public.rmp_skus.id;


--
-- Name: sc_sizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sc_sizes (
    id bigint NOT NULL,
    name character varying,
    "position" integer,
    airtable_id character varying,
    is_deleted boolean DEFAULT false,
    size_type_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: sc_sizes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sc_sizes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sc_sizes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sc_sizes_id_seq OWNED BY public.sc_sizes.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id bigint NOT NULL,
    key character varying,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: size_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.size_types (
    id bigint NOT NULL,
    name character varying,
    airtable_id character varying,
    is_deleted boolean DEFAULT false,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source integer DEFAULT 0 NOT NULL
);


--
-- Name: size_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.size_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: size_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.size_types_id_seq OWNED BY public.size_types.id;


--
-- Name: sizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sizes (
    id bigint NOT NULL,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: sizes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sizes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sizes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sizes_id_seq OWNED BY public.sizes.id;


--
-- Name: stock_infos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_infos (
    id bigint NOT NULL,
    stock_type integer DEFAULT 0 NOT NULL,
    total_quantity integer DEFAULT 0 NOT NULL,
    dispatched_quantity integer DEFAULT 0 NOT NULL,
    available_quantity integer DEFAULT 0 NOT NULL,
    user_id bigint NOT NULL,
    size_id bigint NOT NULL,
    rmp_class_id bigint,
    rmp_brand_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    rmp_category_id bigint,
    product_identifier text,
    product_id bigint
);


--
-- Name: stock_infos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_infos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_infos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_infos_id_seq OWNED BY public.stock_infos.id;


--
-- Name: stock_useds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_useds (
    id bigint NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    dispatched_quantity_id bigint NOT NULL,
    stock_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: stock_useds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_useds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_useds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_useds_id_seq OWNED BY public.stock_useds.id;


--
-- Name: stocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stocks (
    id bigint NOT NULL,
    stock_type integer DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    dispatched_quantity integer DEFAULT 0 NOT NULL,
    order_id bigint NOT NULL,
    item_id bigint NOT NULL,
    size_id bigint NOT NULL,
    rmp_sku_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    user_id bigint NOT NULL,
    rmp_class_id bigint,
    rmp_brand_id bigint,
    rmp_category_id bigint,
    product_identifier text,
    product_id bigint
);


--
-- Name: stocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stocks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stocks_id_seq OWNED BY public.stocks.id;


--
-- Name: sync_airtables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_airtables (
    id bigint NOT NULL,
    sync_time timestamp(6) without time zone NOT NULL,
    sync_status integer DEFAULT 0 NOT NULL,
    sync_errors jsonb,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: sync_airtables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_airtables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_airtables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_airtables_id_seq OWNED BY public.sync_airtables.id;


--
-- Name: task_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_users (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: task_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_users_id_seq OWNED BY public.task_users.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    note text,
    status integer DEFAULT 0 NOT NULL,
    deadline timestamp(6) without time zone,
    created_by_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    updated_by_id bigint,
    order_id bigint
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: user_dealers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_dealers (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    dealer_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    dealers_count integer DEFAULT 0 NOT NULL
);


--
-- Name: user_dealers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_dealers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_dealers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_dealers_id_seq OWNED BY public.user_dealers.id;


--
-- Name: user_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_devices (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    fcm_token text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: user_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_devices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_devices_id_seq OWNED BY public.user_devices.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying DEFAULT ''::character varying NOT NULL,
    encrypted_password character varying DEFAULT ''::character varying NOT NULL,
    reset_password_token character varying,
    reset_password_sent_at timestamp(6) without time zone,
    remember_created_at timestamp(6) without time zone,
    sign_in_count integer DEFAULT 0 NOT NULL,
    current_sign_in_at timestamp(6) without time zone,
    last_sign_in_at timestamp(6) without time zone,
    current_sign_in_ip character varying,
    last_sign_in_ip character varying,
    confirmation_token character varying,
    confirmed_at timestamp(6) without time zone,
    confirmation_sent_at timestamp(6) without time zone,
    unconfirmed_email character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    deleted_at timestamp(6) without time zone,
    profile_image character varying,
    name character varying,
    phone character varying,
    disabled boolean DEFAULT false NOT NULL,
    role integer NOT NULL,
    gst_no character varying,
    factory_id bigint,
    parent_tailor_id bigint,
    last_active timestamp(6) without time zone,
    factory_manager_id bigint,
    completed_count integer DEFAULT 0 NOT NULL,
    pending_count integer DEFAULT 0 NOT NULL,
    due_count integer DEFAULT 0 NOT NULL,
    active_count integer DEFAULT 0 NOT NULL,
    yet_to_begin_count integer DEFAULT 0 NOT NULL,
    rmp_price_type_id bigint,
    uc_customer_id character varying,
    catalogue text,
    ratings_given_avg numeric,
    ratings_received_avg numeric,
    created_by_id bigint,
    approved boolean,
    approved_at timestamp(6) without time zone,
    onboarded boolean DEFAULT false NOT NULL,
    onboarded_at timestamp(6) without time zone,
    customer_registered_by integer DEFAULT 1 NOT NULL,
    customer_company_name character varying,
    customer_first_name character varying,
    customer_last_name character varying,
    zone_id bigint,
    airtable_id character varying,
    fcm_token character varying,
    disabled_at timestamp(6) without time zone,
    dealers_count integer DEFAULT 0 NOT NULL,
    designation character varying,
    features jsonb DEFAULT '[]'::jsonb,
    completed_orders_amount integer DEFAULT 0,
    rank integer,
    is_direct_deal boolean DEFAULT false,
    auto_approve_customers boolean DEFAULT false,
    stock_visibility_percentage double precision DEFAULT 100.0
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id bigint NOT NULL,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    is_deleted boolean DEFAULT false
);


--
-- Name: zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zones_id_seq OWNED BY public.zones.id;


--
-- Name: add_on_base_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_base_products ALTER COLUMN id SET DEFAULT nextval('public.add_on_base_products_id_seq'::regclass);


--
-- Name: add_on_colors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_colors ALTER COLUMN id SET DEFAULT nextval('public.add_on_colors_id_seq'::regclass);


--
-- Name: add_on_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_parts ALTER COLUMN id SET DEFAULT nextval('public.add_on_parts_id_seq'::regclass);


--
-- Name: add_ons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_ons ALTER COLUMN id SET DEFAULT nextval('public.add_ons_id_seq'::regclass);


--
-- Name: addresses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses ALTER COLUMN id SET DEFAULT nextval('public.addresses_id_seq'::regclass);


--
-- Name: app_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_configs ALTER COLUMN id SET DEFAULT nextval('public.app_configs_id_seq'::regclass);


--
-- Name: asset_infos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_infos ALTER COLUMN id SET DEFAULT nextval('public.asset_infos_id_seq'::regclass);


--
-- Name: assigned_brands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assigned_brands ALTER COLUMN id SET DEFAULT nextval('public.assigned_brands_id_seq'::regclass);


--
-- Name: authorized_brands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorized_brands ALTER COLUMN id SET DEFAULT nextval('public.authorized_brands_id_seq'::regclass);


--
-- Name: back_order_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_order_links ALTER COLUMN id SET DEFAULT nextval('public.back_order_links_id_seq'::regclass);


--
-- Name: base_product_asset_infos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_asset_infos ALTER COLUMN id SET DEFAULT nextval('public.base_product_asset_infos_id_seq'::regclass);


--
-- Name: base_product_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_categories ALTER COLUMN id SET DEFAULT nextval('public.base_product_categories_id_seq'::regclass);


--
-- Name: base_product_fabrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_fabrics ALTER COLUMN id SET DEFAULT nextval('public.base_product_fabrics_id_seq'::regclass);


--
-- Name: base_product_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_parts ALTER COLUMN id SET DEFAULT nextval('public.base_product_parts_id_seq'::regclass);


--
-- Name: base_product_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_types ALTER COLUMN id SET DEFAULT nextval('public.base_product_types_id_seq'::regclass);


--
-- Name: base_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_products ALTER COLUMN id SET DEFAULT nextval('public.base_products_id_seq'::regclass);


--
-- Name: base_size_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_size_types ALTER COLUMN id SET DEFAULT nextval('public.base_size_types_id_seq'::regclass);


--
-- Name: brandings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brandings ALTER COLUMN id SET DEFAULT nextval('public.brandings_id_seq'::regclass);


--
-- Name: bulk_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_uploads ALTER COLUMN id SET DEFAULT nextval('public.bulk_uploads_id_seq'::regclass);


--
-- Name: catalogues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogues ALTER COLUMN id SET DEFAULT nextval('public.catalogues_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: cities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities ALTER COLUMN id SET DEFAULT nextval('public.cities_id_seq'::regclass);


--
-- Name: colors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colors ALTER COLUMN id SET DEFAULT nextval('public.colors_id_seq'::regclass);


--
-- Name: criteria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criteria ALTER COLUMN id SET DEFAULT nextval('public.criteria_id_seq'::regclass);


--
-- Name: customer_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_requests ALTER COLUMN id SET DEFAULT nextval('public.customer_requests_id_seq'::regclass);


--
-- Name: dispatched_quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatched_quantities ALTER COLUMN id SET DEFAULT nextval('public.dispatched_quantities_id_seq'::regclass);


--
-- Name: extra_quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extra_quantities ALTER COLUMN id SET DEFAULT nextval('public.extra_quantities_id_seq'::regclass);


--
-- Name: fabric_colors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_colors ALTER COLUMN id SET DEFAULT nextval('public.fabric_colors_id_seq'::regclass);


--
-- Name: fabrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabrics ALTER COLUMN id SET DEFAULT nextval('public.fabrics_id_seq'::regclass);


--
-- Name: factories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factories ALTER COLUMN id SET DEFAULT nextval('public.factories_id_seq'::regclass);


--
-- Name: item_criteria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria ALTER COLUMN id SET DEFAULT nextval('public.item_criteria_id_seq'::regclass);


--
-- Name: item_tailor_quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailor_quantities ALTER COLUMN id SET DEFAULT nextval('public.item_tailor_quantities_id_seq'::regclass);


--
-- Name: item_tailors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailors ALTER COLUMN id SET DEFAULT nextval('public.item_tailors_id_seq'::regclass);


--
-- Name: items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items ALTER COLUMN id SET DEFAULT nextval('public.items_id_seq'::regclass);


--
-- Name: job_sheet_assign_dates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_dates ALTER COLUMN id SET DEFAULT nextval('public.job_sheet_assign_dates_id_seq'::regclass);


--
-- Name: job_sheet_assign_quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities ALTER COLUMN id SET DEFAULT nextval('public.job_sheet_assign_quantities_id_seq'::regclass);


--
-- Name: job_sheet_assign_tailors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_tailors ALTER COLUMN id SET DEFAULT nextval('public.job_sheet_assign_tailors_id_seq'::regclass);


--
-- Name: job_sheet_dispatched_dates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_dispatched_dates ALTER COLUMN id SET DEFAULT nextval('public.job_sheet_dispatched_dates_id_seq'::regclass);


--
-- Name: job_sheet_mark_tailors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_mark_tailors ALTER COLUMN id SET DEFAULT nextval('public.job_sheet_mark_tailors_id_seq'::regclass);


--
-- Name: job_sheet_tailor_mark_dates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_tailor_mark_dates ALTER COLUMN id SET DEFAULT nextval('public.job_sheet_tailor_mark_dates_id_seq'::regclass);


--
-- Name: mark_cutting_quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cutting_quantities ALTER COLUMN id SET DEFAULT nextval('public.mark_cutting_quantities_id_seq'::regclass);


--
-- Name: mark_cuttings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cuttings ALTER COLUMN id SET DEFAULT nextval('public.mark_cuttings_id_seq'::regclass);


--
-- Name: mark_tailor_quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_tailor_quantities ALTER COLUMN id SET DEFAULT nextval('public.mark_tailor_quantities_id_seq'::regclass);


--
-- Name: milestones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones ALTER COLUMN id SET DEFAULT nextval('public.milestones_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: part_colors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_colors ALTER COLUMN id SET DEFAULT nextval('public.part_colors_id_seq'::regclass);


--
-- Name: parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts ALTER COLUMN id SET DEFAULT nextval('public.parts_id_seq'::regclass);


--
-- Name: product_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images ALTER COLUMN id SET DEFAULT nextval('public.product_images_id_seq'::regclass);


--
-- Name: product_part_add_ons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_part_add_ons ALTER COLUMN id SET DEFAULT nextval('public.product_part_add_ons_id_seq'::regclass);


--
-- Name: product_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_parts ALTER COLUMN id SET DEFAULT nextval('public.product_parts_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: profit_margins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_margins ALTER COLUMN id SET DEFAULT nextval('public.profit_margins_id_seq'::regclass);


--
-- Name: promotional_banners id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotional_banners ALTER COLUMN id SET DEFAULT nextval('public.promotional_banners_id_seq'::regclass);


--
-- Name: promotions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions ALTER COLUMN id SET DEFAULT nextval('public.promotions_id_seq'::regclass);


--
-- Name: quantities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantities ALTER COLUMN id SET DEFAULT nextval('public.quantities_id_seq'::regclass);


--
-- Name: ratings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings ALTER COLUMN id SET DEFAULT nextval('public.ratings_id_seq'::regclass);


--
-- Name: reset_password_histories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_password_histories ALTER COLUMN id SET DEFAULT nextval('public.reset_password_histories_id_seq'::regclass);


--
-- Name: responsibilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responsibilities ALTER COLUMN id SET DEFAULT nextval('public.responsibilities_id_seq'::regclass);


--
-- Name: rmp_brands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_brands ALTER COLUMN id SET DEFAULT nextval('public.rmp_brands_id_seq'::regclass);


--
-- Name: rmp_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_categories ALTER COLUMN id SET DEFAULT nextval('public.rmp_categories_id_seq'::regclass);


--
-- Name: rmp_category_brands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_category_brands ALTER COLUMN id SET DEFAULT nextval('public.rmp_category_brands_id_seq'::regclass);


--
-- Name: rmp_classes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_classes ALTER COLUMN id SET DEFAULT nextval('public.rmp_classes_id_seq'::regclass);


--
-- Name: rmp_colors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_colors ALTER COLUMN id SET DEFAULT nextval('public.rmp_colors_id_seq'::regclass);


--
-- Name: rmp_min_infos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_min_infos ALTER COLUMN id SET DEFAULT nextval('public.rmp_min_infos_id_seq'::regclass);


--
-- Name: rmp_price_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_price_types ALTER COLUMN id SET DEFAULT nextval('public.rmp_price_types_id_seq'::regclass);


--
-- Name: rmp_prices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_prices ALTER COLUMN id SET DEFAULT nextval('public.rmp_prices_id_seq'::regclass);


--
-- Name: rmp_sizes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_sizes ALTER COLUMN id SET DEFAULT nextval('public.rmp_sizes_id_seq'::regclass);


--
-- Name: rmp_sku_prices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_sku_prices ALTER COLUMN id SET DEFAULT nextval('public.rmp_sku_prices_id_seq'::regclass);


--
-- Name: rmp_skus id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_skus ALTER COLUMN id SET DEFAULT nextval('public.rmp_skus_id_seq'::regclass);


--
-- Name: sc_sizes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sc_sizes ALTER COLUMN id SET DEFAULT nextval('public.sc_sizes_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: size_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.size_types ALTER COLUMN id SET DEFAULT nextval('public.size_types_id_seq'::regclass);


--
-- Name: sizes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sizes ALTER COLUMN id SET DEFAULT nextval('public.sizes_id_seq'::regclass);


--
-- Name: stock_infos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos ALTER COLUMN id SET DEFAULT nextval('public.stock_infos_id_seq'::regclass);


--
-- Name: stock_useds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_useds ALTER COLUMN id SET DEFAULT nextval('public.stock_useds_id_seq'::regclass);


--
-- Name: stocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks ALTER COLUMN id SET DEFAULT nextval('public.stocks_id_seq'::regclass);


--
-- Name: sync_airtables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_airtables ALTER COLUMN id SET DEFAULT nextval('public.sync_airtables_id_seq'::regclass);


--
-- Name: task_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_users ALTER COLUMN id SET DEFAULT nextval('public.task_users_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: user_dealers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dealers ALTER COLUMN id SET DEFAULT nextval('public.user_dealers_id_seq'::regclass);


--
-- Name: user_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices ALTER COLUMN id SET DEFAULT nextval('public.user_devices_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones ALTER COLUMN id SET DEFAULT nextval('public.zones_id_seq'::regclass);


--
-- Name: add_on_base_products add_on_base_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_base_products
    ADD CONSTRAINT add_on_base_products_pkey PRIMARY KEY (id);


--
-- Name: add_on_colors add_on_colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_colors
    ADD CONSTRAINT add_on_colors_pkey PRIMARY KEY (id);


--
-- Name: add_on_parts add_on_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_parts
    ADD CONSTRAINT add_on_parts_pkey PRIMARY KEY (id);


--
-- Name: add_ons add_ons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_ons
    ADD CONSTRAINT add_ons_pkey PRIMARY KEY (id);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: app_configs app_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_configs
    ADD CONSTRAINT app_configs_pkey PRIMARY KEY (id);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: asset_infos asset_infos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_infos
    ADD CONSTRAINT asset_infos_pkey PRIMARY KEY (id);


--
-- Name: assigned_brands assigned_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assigned_brands
    ADD CONSTRAINT assigned_brands_pkey PRIMARY KEY (id);


--
-- Name: authorized_brands authorized_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorized_brands
    ADD CONSTRAINT authorized_brands_pkey PRIMARY KEY (id);


--
-- Name: back_order_links back_order_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_order_links
    ADD CONSTRAINT back_order_links_pkey PRIMARY KEY (id);


--
-- Name: base_product_asset_infos base_product_asset_infos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_asset_infos
    ADD CONSTRAINT base_product_asset_infos_pkey PRIMARY KEY (id);


--
-- Name: base_product_categories base_product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_categories
    ADD CONSTRAINT base_product_categories_pkey PRIMARY KEY (id);


--
-- Name: base_product_fabrics base_product_fabrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_fabrics
    ADD CONSTRAINT base_product_fabrics_pkey PRIMARY KEY (id);


--
-- Name: base_product_parts base_product_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_parts
    ADD CONSTRAINT base_product_parts_pkey PRIMARY KEY (id);


--
-- Name: base_product_types base_product_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_types
    ADD CONSTRAINT base_product_types_pkey PRIMARY KEY (id);


--
-- Name: base_products base_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_products
    ADD CONSTRAINT base_products_pkey PRIMARY KEY (id);


--
-- Name: base_size_types base_size_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_size_types
    ADD CONSTRAINT base_size_types_pkey PRIMARY KEY (id);


--
-- Name: brandings brandings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brandings
    ADD CONSTRAINT brandings_pkey PRIMARY KEY (id);


--
-- Name: bulk_uploads bulk_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_uploads
    ADD CONSTRAINT bulk_uploads_pkey PRIMARY KEY (id);


--
-- Name: catalogues catalogues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogues
    ADD CONSTRAINT catalogues_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: colors colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colors
    ADD CONSTRAINT colors_pkey PRIMARY KEY (id);


--
-- Name: criteria criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.criteria
    ADD CONSTRAINT criteria_pkey PRIMARY KEY (id);


--
-- Name: customer_requests customer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_requests
    ADD CONSTRAINT customer_requests_pkey PRIMARY KEY (id);


--
-- Name: dispatched_quantities dispatched_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatched_quantities
    ADD CONSTRAINT dispatched_quantities_pkey PRIMARY KEY (id);


--
-- Name: extra_quantities extra_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extra_quantities
    ADD CONSTRAINT extra_quantities_pkey PRIMARY KEY (id);


--
-- Name: fabric_colors fabric_colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_colors
    ADD CONSTRAINT fabric_colors_pkey PRIMARY KEY (id);


--
-- Name: fabrics fabrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabrics
    ADD CONSTRAINT fabrics_pkey PRIMARY KEY (id);


--
-- Name: factories factories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factories
    ADD CONSTRAINT factories_pkey PRIMARY KEY (id);


--
-- Name: item_criteria item_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria
    ADD CONSTRAINT item_criteria_pkey PRIMARY KEY (id);


--
-- Name: item_tailor_quantities item_tailor_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailor_quantities
    ADD CONSTRAINT item_tailor_quantities_pkey PRIMARY KEY (id);


--
-- Name: item_tailors item_tailors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailors
    ADD CONSTRAINT item_tailors_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: job_sheet_assign_dates job_sheet_assign_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_dates
    ADD CONSTRAINT job_sheet_assign_dates_pkey PRIMARY KEY (id);


--
-- Name: job_sheet_assign_quantities job_sheet_assign_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities
    ADD CONSTRAINT job_sheet_assign_quantities_pkey PRIMARY KEY (id);


--
-- Name: job_sheet_assign_tailors job_sheet_assign_tailors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_tailors
    ADD CONSTRAINT job_sheet_assign_tailors_pkey PRIMARY KEY (id);


--
-- Name: job_sheet_dispatched_dates job_sheet_dispatched_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_dispatched_dates
    ADD CONSTRAINT job_sheet_dispatched_dates_pkey PRIMARY KEY (id);


--
-- Name: job_sheet_mark_tailors job_sheet_mark_tailors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_mark_tailors
    ADD CONSTRAINT job_sheet_mark_tailors_pkey PRIMARY KEY (id);


--
-- Name: job_sheet_tailor_mark_dates job_sheet_tailor_mark_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_tailor_mark_dates
    ADD CONSTRAINT job_sheet_tailor_mark_dates_pkey PRIMARY KEY (id);


--
-- Name: mark_cutting_quantities mark_cutting_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cutting_quantities
    ADD CONSTRAINT mark_cutting_quantities_pkey PRIMARY KEY (id);


--
-- Name: mark_cuttings mark_cuttings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cuttings
    ADD CONSTRAINT mark_cuttings_pkey PRIMARY KEY (id);


--
-- Name: mark_tailor_quantities mark_tailor_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_tailor_quantities
    ADD CONSTRAINT mark_tailor_quantities_pkey PRIMARY KEY (id);


--
-- Name: milestones milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: part_colors part_colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_colors
    ADD CONSTRAINT part_colors_pkey PRIMARY KEY (id);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_part_add_ons product_part_add_ons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_part_add_ons
    ADD CONSTRAINT product_part_add_ons_pkey PRIMARY KEY (id);


--
-- Name: product_parts product_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_parts
    ADD CONSTRAINT product_parts_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profit_margins profit_margins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_margins
    ADD CONSTRAINT profit_margins_pkey PRIMARY KEY (id);


--
-- Name: promotional_banners promotional_banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotional_banners
    ADD CONSTRAINT promotional_banners_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: quantities quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantities
    ADD CONSTRAINT quantities_pkey PRIMARY KEY (id);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


--
-- Name: reset_password_histories reset_password_histories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_password_histories
    ADD CONSTRAINT reset_password_histories_pkey PRIMARY KEY (id);


--
-- Name: responsibilities responsibilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responsibilities
    ADD CONSTRAINT responsibilities_pkey PRIMARY KEY (id);


--
-- Name: rmp_brands rmp_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_brands
    ADD CONSTRAINT rmp_brands_pkey PRIMARY KEY (id);


--
-- Name: rmp_categories rmp_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_categories
    ADD CONSTRAINT rmp_categories_pkey PRIMARY KEY (id);


--
-- Name: rmp_category_brands rmp_category_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_category_brands
    ADD CONSTRAINT rmp_category_brands_pkey PRIMARY KEY (id);


--
-- Name: rmp_classes rmp_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_classes
    ADD CONSTRAINT rmp_classes_pkey PRIMARY KEY (id);


--
-- Name: rmp_colors rmp_colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_colors
    ADD CONSTRAINT rmp_colors_pkey PRIMARY KEY (id);


--
-- Name: rmp_min_infos rmp_min_infos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_min_infos
    ADD CONSTRAINT rmp_min_infos_pkey PRIMARY KEY (id);


--
-- Name: rmp_price_types rmp_price_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_price_types
    ADD CONSTRAINT rmp_price_types_pkey PRIMARY KEY (id);


--
-- Name: rmp_prices rmp_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_prices
    ADD CONSTRAINT rmp_prices_pkey PRIMARY KEY (id);


--
-- Name: rmp_sizes rmp_sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_sizes
    ADD CONSTRAINT rmp_sizes_pkey PRIMARY KEY (id);


--
-- Name: rmp_sku_prices rmp_sku_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_sku_prices
    ADD CONSTRAINT rmp_sku_prices_pkey PRIMARY KEY (id);


--
-- Name: rmp_skus rmp_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_skus
    ADD CONSTRAINT rmp_skus_pkey PRIMARY KEY (id);


--
-- Name: sc_sizes sc_sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sc_sizes
    ADD CONSTRAINT sc_sizes_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: size_types size_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.size_types
    ADD CONSTRAINT size_types_pkey PRIMARY KEY (id);


--
-- Name: sizes sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sizes
    ADD CONSTRAINT sizes_pkey PRIMARY KEY (id);


--
-- Name: stock_infos stock_infos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT stock_infos_pkey PRIMARY KEY (id);


--
-- Name: stock_useds stock_useds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_useds
    ADD CONSTRAINT stock_useds_pkey PRIMARY KEY (id);


--
-- Name: stocks stocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT stocks_pkey PRIMARY KEY (id);


--
-- Name: sync_airtables sync_airtables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_airtables
    ADD CONSTRAINT sync_airtables_pkey PRIMARY KEY (id);


--
-- Name: task_users task_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_users
    ADD CONSTRAINT task_users_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: user_dealers user_dealers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dealers
    ADD CONSTRAINT user_dealers_pkey PRIMARY KEY (id);


--
-- Name: user_devices user_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: index_add_on_base_products_on_add_on_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_base_products_on_add_on_id ON public.add_on_base_products USING btree (add_on_id);


--
-- Name: index_add_on_base_products_on_asset_info_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_base_products_on_asset_info_id ON public.add_on_base_products USING btree (asset_info_id);


--
-- Name: index_add_on_base_products_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_base_products_on_base_product_id ON public.add_on_base_products USING btree (base_product_id);


--
-- Name: index_add_on_colors_on_add_on_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_colors_on_add_on_id ON public.add_on_colors USING btree (add_on_id);


--
-- Name: index_add_on_colors_on_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_colors_on_color_id ON public.add_on_colors USING btree (color_id);


--
-- Name: index_add_on_parts_on_add_on_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_parts_on_add_on_id ON public.add_on_parts USING btree (add_on_id);


--
-- Name: index_add_on_parts_on_asset_info_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_parts_on_asset_info_id ON public.add_on_parts USING btree (asset_info_id);


--
-- Name: index_add_on_parts_on_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_add_on_parts_on_part_id ON public.add_on_parts USING btree (part_id);


--
-- Name: index_addresses_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_addresses_on_user_id ON public.addresses USING btree (user_id);


--
-- Name: index_assigned_brands_on_authorized_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_assigned_brands_on_authorized_brand_id ON public.assigned_brands USING btree (authorized_brand_id);


--
-- Name: index_assigned_brands_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_assigned_brands_on_user_id ON public.assigned_brands USING btree (user_id);


--
-- Name: index_authorized_brands_on_airtable_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_authorized_brands_on_airtable_id ON public.authorized_brands USING btree (airtable_id);


--
-- Name: index_authorized_brands_on_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_authorized_brands_on_name ON public.authorized_brands USING btree (name);


--
-- Name: index_back_order_links_on_back_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_back_order_links_on_back_order_id ON public.back_order_links USING btree (back_order_id);


--
-- Name: index_back_order_links_on_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_back_order_links_on_order_id ON public.back_order_links USING btree (order_id);


--
-- Name: index_base_product_asset_infos_on_add_on_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_asset_infos_on_add_on_id ON public.base_product_asset_infos USING btree (add_on_id);


--
-- Name: index_base_product_asset_infos_on_asset_info_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_asset_infos_on_asset_info_id ON public.base_product_asset_infos USING btree (asset_info_id);


--
-- Name: index_base_product_asset_infos_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_asset_infos_on_base_product_id ON public.base_product_asset_infos USING btree (base_product_id);


--
-- Name: index_base_product_asset_infos_on_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_asset_infos_on_part_id ON public.base_product_asset_infos USING btree (part_id);


--
-- Name: index_base_product_categories_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_categories_on_base_product_id ON public.base_product_categories USING btree (base_product_id);


--
-- Name: index_base_product_categories_on_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_categories_on_category_id ON public.base_product_categories USING btree (category_id);


--
-- Name: index_base_product_fabrics_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_fabrics_on_base_product_id ON public.base_product_fabrics USING btree (base_product_id);


--
-- Name: index_base_product_fabrics_on_fabric_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_fabrics_on_fabric_id ON public.base_product_fabrics USING btree (fabric_id);


--
-- Name: index_base_product_parts_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_parts_on_base_product_id ON public.base_product_parts USING btree (base_product_id);


--
-- Name: index_base_product_parts_on_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_product_parts_on_part_id ON public.base_product_parts USING btree (part_id);


--
-- Name: index_base_products_on_asset_info_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_products_on_asset_info_id ON public.base_products USING btree (asset_info_id);


--
-- Name: index_base_size_types_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_size_types_on_base_product_id ON public.base_size_types USING btree (base_product_id);


--
-- Name: index_base_size_types_on_size_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_base_size_types_on_size_type_id ON public.base_size_types USING btree (size_type_id);


--
-- Name: index_brandings_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_brandings_on_item_id ON public.brandings USING btree (item_id);


--
-- Name: index_brandings_on_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_brandings_on_parent_id ON public.brandings USING btree (parent_id);


--
-- Name: index_brandings_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_brandings_on_product_id ON public.brandings USING btree (product_id);


--
-- Name: index_bulk_uploads_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_bulk_uploads_on_user_id ON public.bulk_uploads USING btree (user_id);


--
-- Name: index_catalogues_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_catalogues_on_user_id ON public.catalogues USING btree (user_id);


--
-- Name: index_cities_on_zone_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_cities_on_zone_id ON public.cities USING btree (zone_id);


--
-- Name: index_colors_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_colors_on_created_by_id ON public.colors USING btree (created_by_id);


--
-- Name: index_customer_requests_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_customer_requests_on_user_id ON public.customer_requests USING btree (user_id);


--
-- Name: index_dispatched_quantities_on_job_sheet_dispatched_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_dispatched_quantities_on_job_sheet_dispatched_date_id ON public.dispatched_quantities USING btree (job_sheet_dispatched_date_id);


--
-- Name: index_dispatched_quantities_on_quantity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_dispatched_quantities_on_quantity_id ON public.dispatched_quantities USING btree (quantity_id);


--
-- Name: index_extra_quantities_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_extra_quantities_on_item_id ON public.extra_quantities USING btree (item_id);


--
-- Name: index_extra_quantities_on_size_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_extra_quantities_on_size_id ON public.extra_quantities USING btree (size_id);


--
-- Name: index_fabric_colors_on_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_fabric_colors_on_color_id ON public.fabric_colors USING btree (color_id);


--
-- Name: index_fabric_colors_on_fabric_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_fabric_colors_on_fabric_id ON public.fabric_colors USING btree (fabric_id);


--
-- Name: index_item_criteria_on_checked_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_criteria_on_checked_by_id ON public.item_criteria USING btree (checked_by_id);


--
-- Name: index_item_criteria_on_criteria_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_criteria_on_criteria_id ON public.item_criteria USING btree (criteria_id);


--
-- Name: index_item_criteria_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_criteria_on_item_id ON public.item_criteria USING btree (item_id);


--
-- Name: index_item_criteria_on_unchecked_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_criteria_on_unchecked_by_id ON public.item_criteria USING btree (unchecked_by_id);


--
-- Name: index_item_criteria_on_updated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_criteria_on_updated_by_id ON public.item_criteria USING btree (updated_by_id);


--
-- Name: index_item_tailor_quantities_on_item_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_tailor_quantities_on_item_tailor_id ON public.item_tailor_quantities USING btree (item_tailor_id);


--
-- Name: index_item_tailor_quantities_on_quantity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_tailor_quantities_on_quantity_id ON public.item_tailor_quantities USING btree (quantity_id);


--
-- Name: index_item_tailors_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_tailors_on_item_id ON public.item_tailors USING btree (item_id);


--
-- Name: index_item_tailors_on_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_item_tailors_on_tailor_id ON public.item_tailors USING btree (tailor_id);


--
-- Name: index_items_on_cutting_master_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_items_on_cutting_master_id ON public.items USING btree (cutting_master_id);


--
-- Name: index_items_on_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_items_on_order_id ON public.items USING btree (order_id);


--
-- Name: index_items_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_items_on_product_id ON public.items USING btree (product_id);


--
-- Name: index_items_on_rmp_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_items_on_rmp_brand_id ON public.items USING btree (rmp_brand_id);


--
-- Name: index_items_on_rmp_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_items_on_rmp_category_id ON public.items USING btree (rmp_category_id);


--
-- Name: index_items_on_rmp_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_items_on_rmp_class_id ON public.items USING btree (rmp_class_id);


--
-- Name: index_job_sheet_assign_dates_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_dates_on_item_id ON public.job_sheet_assign_dates USING btree (item_id);


--
-- Name: index_job_sheet_assign_quantities_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_quantities_on_item_id ON public.job_sheet_assign_quantities USING btree (item_id);


--
-- Name: index_job_sheet_assign_quantities_on_item_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_quantities_on_item_tailor_id ON public.job_sheet_assign_quantities USING btree (item_tailor_id);


--
-- Name: index_job_sheet_assign_quantities_on_job_sheet_assign_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_quantities_on_job_sheet_assign_date_id ON public.job_sheet_assign_quantities USING btree (job_sheet_assign_date_id);


--
-- Name: index_job_sheet_assign_quantities_on_job_sheet_assign_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_quantities_on_job_sheet_assign_tailor_id ON public.job_sheet_assign_quantities USING btree (job_sheet_assign_tailor_id);


--
-- Name: index_job_sheet_assign_quantities_on_quantity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_quantities_on_quantity_id ON public.job_sheet_assign_quantities USING btree (quantity_id);


--
-- Name: index_job_sheet_assign_tailors_on_item_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_tailors_on_item_tailor_id ON public.job_sheet_assign_tailors USING btree (item_tailor_id);


--
-- Name: index_job_sheet_assign_tailors_on_job_sheet_assign_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_assign_tailors_on_job_sheet_assign_date_id ON public.job_sheet_assign_tailors USING btree (job_sheet_assign_date_id);


--
-- Name: index_job_sheet_dispatched_dates_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_dispatched_dates_on_item_id ON public.job_sheet_dispatched_dates USING btree (item_id);


--
-- Name: index_job_sheet_mark_tailors_on_item_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_mark_tailors_on_item_tailor_id ON public.job_sheet_mark_tailors USING btree (item_tailor_id);


--
-- Name: index_job_sheet_mark_tailors_on_job_sheet_tailor_mark_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_mark_tailors_on_job_sheet_tailor_mark_date_id ON public.job_sheet_mark_tailors USING btree (job_sheet_tailor_mark_date_id);


--
-- Name: index_job_sheet_tailor_mark_dates_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_job_sheet_tailor_mark_dates_on_item_id ON public.job_sheet_tailor_mark_dates USING btree (item_id);


--
-- Name: index_mark_cutting_quantities_on_mark_cutting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_mark_cutting_quantities_on_mark_cutting_id ON public.mark_cutting_quantities USING btree (mark_cutting_id);


--
-- Name: index_mark_cutting_quantities_on_quantity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_mark_cutting_quantities_on_quantity_id ON public.mark_cutting_quantities USING btree (quantity_id);


--
-- Name: index_mark_cuttings_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_mark_cuttings_on_item_id ON public.mark_cuttings USING btree (item_id);


--
-- Name: index_mark_tailor_quantities_on_item_tailor_quantity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_mark_tailor_quantities_on_item_tailor_quantity_id ON public.mark_tailor_quantities USING btree (item_tailor_quantity_id);


--
-- Name: index_mark_tailor_quantities_on_job_sheet_mark_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_mark_tailor_quantities_on_job_sheet_mark_tailor_id ON public.mark_tailor_quantities USING btree (job_sheet_mark_tailor_id);


--
-- Name: index_milestones_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_milestones_on_user_id ON public.milestones USING btree (user_id);


--
-- Name: index_notifications_on_job_sheet_dispatched_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notifications_on_job_sheet_dispatched_date_id ON public.notifications USING btree (job_sheet_dispatched_date_id);


--
-- Name: index_notifications_on_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notifications_on_order_id ON public.notifications USING btree (order_id);


--
-- Name: index_notifications_on_recipient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notifications_on_recipient_id ON public.notifications USING btree (recipient_id);


--
-- Name: index_orders_on_address_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_address_id ON public.orders USING btree (address_id);


--
-- Name: index_orders_on_assigned_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_assigned_by_id ON public.orders USING btree (assigned_by_id);


--
-- Name: index_orders_on_assigned_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_assigned_to_id ON public.orders USING btree (assigned_to_id);


--
-- Name: index_orders_on_back_order_for_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_back_order_for_id ON public.orders USING btree (back_order_for_id);


--
-- Name: index_orders_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_created_by_id ON public.orders USING btree (created_by_id);


--
-- Name: index_orders_on_customer_dealer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_customer_dealer_id ON public.orders USING btree (customer_dealer_id);


--
-- Name: index_orders_on_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_customer_id ON public.orders USING btree (customer_id);


--
-- Name: index_orders_on_customer_sc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_customer_sc_id ON public.orders USING btree (customer_sc_id);


--
-- Name: index_orders_on_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_orders_on_deleted_at ON public.orders USING btree (deleted_at);


--
-- Name: index_part_colors_on_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_part_colors_on_color_id ON public.part_colors USING btree (color_id);


--
-- Name: index_part_colors_on_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_part_colors_on_part_id ON public.part_colors USING btree (part_id);


--
-- Name: index_product_images_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_images_on_product_id ON public.product_images USING btree (product_id);


--
-- Name: index_product_part_add_ons_on_add_on_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_part_add_ons_on_add_on_color_id ON public.product_part_add_ons USING btree (add_on_color_id);


--
-- Name: index_product_part_add_ons_on_add_on_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_part_add_ons_on_add_on_id ON public.product_part_add_ons USING btree (add_on_id);


--
-- Name: index_product_part_add_ons_on_product_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_part_add_ons_on_product_part_id ON public.product_part_add_ons USING btree (product_part_id);


--
-- Name: index_product_parts_on_part_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_parts_on_part_color_id ON public.product_parts USING btree (part_color_id);


--
-- Name: index_product_parts_on_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_parts_on_part_id ON public.product_parts USING btree (part_id);


--
-- Name: index_product_parts_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_parts_on_product_id ON public.product_parts USING btree (product_id);


--
-- Name: index_products_on_base_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_base_product_id ON public.products USING btree (base_product_id);


--
-- Name: index_products_on_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_category_id ON public.products USING btree (category_id);


--
-- Name: index_products_on_copy_fabric_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_copy_fabric_color_id ON public.products USING btree (copy_fabric_color_id);


--
-- Name: index_products_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_created_by_id ON public.products USING btree (created_by_id);


--
-- Name: index_products_on_fabric_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_fabric_color_id ON public.products USING btree (fabric_color_id);


--
-- Name: index_products_on_fabric_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_fabric_id ON public.products USING btree (fabric_id);


--
-- Name: index_products_on_style_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_style_number ON public.products USING btree (style_number);


--
-- Name: index_promotional_banners_on_rmp_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_promotional_banners_on_rmp_brand_id ON public.promotional_banners USING btree (rmp_brand_id);


--
-- Name: index_promotional_banners_on_rmp_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_promotional_banners_on_rmp_category_id ON public.promotional_banners USING btree (rmp_category_id);


--
-- Name: index_promotional_banners_on_rmp_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_promotional_banners_on_rmp_class_id ON public.promotional_banners USING btree (rmp_class_id);


--
-- Name: index_quantities_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantities_on_item_id ON public.quantities USING btree (item_id);


--
-- Name: index_quantities_on_size_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantities_on_size_id ON public.quantities USING btree (size_id);


--
-- Name: index_ratings_on_from_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ratings_on_from_id ON public.ratings USING btree (from_id);


--
-- Name: index_ratings_on_rating_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ratings_on_rating_on ON public.ratings USING btree (rating_on_type, rating_on_id);


--
-- Name: index_ratings_on_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ratings_on_to_id ON public.ratings USING btree (to_id);


--
-- Name: index_reset_password_histories_on_changed_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_reset_password_histories_on_changed_by_id ON public.reset_password_histories USING btree (changed_by_id);


--
-- Name: index_reset_password_histories_on_changed_of_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_reset_password_histories_on_changed_of_id ON public.reset_password_histories USING btree (changed_of_id);


--
-- Name: index_responsibilities_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_responsibilities_on_user_id ON public.responsibilities USING btree (user_id);


--
-- Name: index_rmp_category_brands_on_rmp_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_category_brands_on_rmp_brand_id ON public.rmp_category_brands USING btree (rmp_brand_id);


--
-- Name: index_rmp_category_brands_on_rmp_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_category_brands_on_rmp_category_id ON public.rmp_category_brands USING btree (rmp_category_id);


--
-- Name: index_rmp_classes_on_rmp_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_classes_on_rmp_color_id ON public.rmp_classes USING btree (rmp_color_id);


--
-- Name: index_rmp_min_infos_on_rmp_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_min_infos_on_rmp_class_id ON public.rmp_min_infos USING btree (rmp_class_id);


--
-- Name: index_rmp_min_infos_on_rmp_price_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_min_infos_on_rmp_price_type_id ON public.rmp_min_infos USING btree (rmp_price_type_id);


--
-- Name: index_rmp_price_types_on_zone_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_price_types_on_zone_id ON public.rmp_price_types USING btree (zone_id);


--
-- Name: index_rmp_prices_on_rmp_price_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_prices_on_rmp_price_type_id ON public.rmp_prices USING btree (rmp_price_type_id);


--
-- Name: index_rmp_prices_on_rmp_sku_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_prices_on_rmp_sku_id ON public.rmp_prices USING btree (rmp_sku_id);


--
-- Name: index_rmp_sku_prices_on_rmp_price_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_sku_prices_on_rmp_price_id ON public.rmp_sku_prices USING btree (rmp_price_id);


--
-- Name: index_rmp_sku_prices_on_rmp_sku_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_sku_prices_on_rmp_sku_id ON public.rmp_sku_prices USING btree (rmp_sku_id);


--
-- Name: index_rmp_skus_on_rmp_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_skus_on_rmp_brand_id ON public.rmp_skus USING btree (rmp_brand_id);


--
-- Name: index_rmp_skus_on_rmp_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_skus_on_rmp_category_id ON public.rmp_skus USING btree (rmp_category_id);


--
-- Name: index_rmp_skus_on_rmp_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_skus_on_rmp_class_id ON public.rmp_skus USING btree (rmp_class_id);


--
-- Name: index_rmp_skus_on_rmp_size_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_rmp_skus_on_rmp_size_id ON public.rmp_skus USING btree (rmp_size_id);


--
-- Name: index_sc_sizes_on_size_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sc_sizes_on_size_type_id ON public.sc_sizes USING btree (size_type_id);


--
-- Name: index_stock_infos_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_infos_on_product_id ON public.stock_infos USING btree (product_id);


--
-- Name: index_stock_infos_on_rmp_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_infos_on_rmp_brand_id ON public.stock_infos USING btree (rmp_brand_id);


--
-- Name: index_stock_infos_on_rmp_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_infos_on_rmp_category_id ON public.stock_infos USING btree (rmp_category_id);


--
-- Name: index_stock_infos_on_rmp_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_infos_on_rmp_class_id ON public.stock_infos USING btree (rmp_class_id);


--
-- Name: index_stock_infos_on_size_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_infos_on_size_id ON public.stock_infos USING btree (size_id);


--
-- Name: index_stock_infos_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_infos_on_user_id ON public.stock_infos USING btree (user_id);


--
-- Name: index_stock_useds_on_dispatched_quantity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_useds_on_dispatched_quantity_id ON public.stock_useds USING btree (dispatched_quantity_id);


--
-- Name: index_stock_useds_on_stock_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stock_useds_on_stock_id ON public.stock_useds USING btree (stock_id);


--
-- Name: index_stocks_on_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_item_id ON public.stocks USING btree (item_id);


--
-- Name: index_stocks_on_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_order_id ON public.stocks USING btree (order_id);


--
-- Name: index_stocks_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_product_id ON public.stocks USING btree (product_id);


--
-- Name: index_stocks_on_rmp_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_rmp_brand_id ON public.stocks USING btree (rmp_brand_id);


--
-- Name: index_stocks_on_rmp_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_rmp_category_id ON public.stocks USING btree (rmp_category_id);


--
-- Name: index_stocks_on_rmp_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_rmp_class_id ON public.stocks USING btree (rmp_class_id);


--
-- Name: index_stocks_on_rmp_sku_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_rmp_sku_id ON public.stocks USING btree (rmp_sku_id);


--
-- Name: index_stocks_on_size_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_size_id ON public.stocks USING btree (size_id);


--
-- Name: index_stocks_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_stocks_on_user_id ON public.stocks USING btree (user_id);


--
-- Name: index_task_users_on_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_task_users_on_task_id ON public.task_users USING btree (task_id);


--
-- Name: index_task_users_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_task_users_on_user_id ON public.task_users USING btree (user_id);


--
-- Name: index_tasks_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_tasks_on_created_by_id ON public.tasks USING btree (created_by_id);


--
-- Name: index_tasks_on_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_tasks_on_order_id ON public.tasks USING btree (order_id);


--
-- Name: index_tasks_on_updated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_tasks_on_updated_by_id ON public.tasks USING btree (updated_by_id);


--
-- Name: index_user_dealers_on_dealer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_dealers_on_dealer_id ON public.user_dealers USING btree (dealer_id);


--
-- Name: index_user_dealers_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_dealers_on_user_id ON public.user_dealers USING btree (user_id);


--
-- Name: index_user_devices_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_devices_on_user_id ON public.user_devices USING btree (user_id);


--
-- Name: index_users_on_confirmation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_confirmation_token ON public.users USING btree (confirmation_token);


--
-- Name: index_users_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_created_by_id ON public.users USING btree (created_by_id);


--
-- Name: index_users_on_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_deleted_at ON public.users USING btree (deleted_at);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: index_users_on_factory_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_factory_id ON public.users USING btree (factory_id);


--
-- Name: index_users_on_factory_manager_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_factory_manager_id ON public.users USING btree (factory_manager_id);


--
-- Name: index_users_on_parent_tailor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_parent_tailor_id ON public.users USING btree (parent_tailor_id);


--
-- Name: index_users_on_reset_password_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_reset_password_token ON public.users USING btree (reset_password_token);


--
-- Name: index_users_on_rmp_price_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_rmp_price_type_id ON public.users USING btree (rmp_price_type_id);


--
-- Name: index_users_on_zone_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_zone_id ON public.users USING btree (zone_id);


--
-- Name: product_part_add_ons fk_rails_00d668285a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_part_add_ons
    ADD CONSTRAINT fk_rails_00d668285a FOREIGN KEY (add_on_id) REFERENCES public.add_ons(id);


--
-- Name: product_parts fk_rails_013ac89da9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_parts
    ADD CONSTRAINT fk_rails_013ac89da9 FOREIGN KEY (part_color_id) REFERENCES public.part_colors(id);


--
-- Name: job_sheet_dispatched_dates fk_rails_018124ceb5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_dispatched_dates
    ADD CONSTRAINT fk_rails_018124ceb5 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: dispatched_quantities fk_rails_01c4a2e531; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatched_quantities
    ADD CONSTRAINT fk_rails_01c4a2e531 FOREIGN KEY (job_sheet_dispatched_date_id) REFERENCES public.job_sheet_dispatched_dates(id);


--
-- Name: dispatched_quantities fk_rails_01e79c6fba; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatched_quantities
    ADD CONSTRAINT fk_rails_01e79c6fba FOREIGN KEY (quantity_id) REFERENCES public.quantities(id);


--
-- Name: brandings fk_rails_03816f1f80; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brandings
    ADD CONSTRAINT fk_rails_03816f1f80 FOREIGN KEY (parent_id) REFERENCES public.brandings(id);


--
-- Name: brandings fk_rails_03cb9995da; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brandings
    ADD CONSTRAINT fk_rails_03cb9995da FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: base_product_asset_infos fk_rails_07399825a0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_asset_infos
    ADD CONSTRAINT fk_rails_07399825a0 FOREIGN KEY (asset_info_id) REFERENCES public.asset_infos(id);


--
-- Name: add_on_base_products fk_rails_08c301e3bb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_base_products
    ADD CONSTRAINT fk_rails_08c301e3bb FOREIGN KEY (asset_info_id) REFERENCES public.asset_infos(id);


--
-- Name: items fk_rails_0ab3f8350f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_rails_0ab3f8350f FOREIGN KEY (rmp_category_id) REFERENCES public.rmp_categories(id);


--
-- Name: job_sheet_assign_tailors fk_rails_0b2ccdd11f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_tailors
    ADD CONSTRAINT fk_rails_0b2ccdd11f FOREIGN KEY (item_tailor_id) REFERENCES public.item_tailors(id);


--
-- Name: items fk_rails_0c83ab19f8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_rails_0c83ab19f8 FOREIGN KEY (cutting_master_id) REFERENCES public.users(id);


--
-- Name: task_users fk_rails_0e90c6e6ce; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_users
    ADD CONSTRAINT fk_rails_0e90c6e6ce FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: stocks fk_rails_0f87835e71; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_0f87835e71 FOREIGN KEY (rmp_category_id) REFERENCES public.rmp_categories(id);


--
-- Name: product_part_add_ons fk_rails_1765d7cdc2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_part_add_ons
    ADD CONSTRAINT fk_rails_1765d7cdc2 FOREIGN KEY (add_on_color_id) REFERENCES public.add_on_colors(id);


--
-- Name: orders fk_rails_18e597fc1f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_18e597fc1f FOREIGN KEY (assigned_by_id) REFERENCES public.users(id);


--
-- Name: users fk_rails_19c45898a2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_19c45898a2 FOREIGN KEY (factory_id) REFERENCES public.factories(id);


--
-- Name: stock_infos fk_rails_1b39d97a04; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT fk_rails_1b39d97a04 FOREIGN KEY (rmp_class_id) REFERENCES public.rmp_classes(id);


--
-- Name: stocks fk_rails_1b68fbb86c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_1b68fbb86c FOREIGN KEY (rmp_class_id) REFERENCES public.rmp_classes(id);


--
-- Name: product_images fk_rails_1c991d3be6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT fk_rails_1c991d3be6 FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: ratings fk_rails_1e4209ccd7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT fk_rails_1e4209ccd7 FOREIGN KEY (from_id) REFERENCES public.users(id);


--
-- Name: rmp_sku_prices fk_rails_1e5ef23b7e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_sku_prices
    ADD CONSTRAINT fk_rails_1e5ef23b7e FOREIGN KEY (rmp_sku_id) REFERENCES public.rmp_skus(id);


--
-- Name: base_product_parts fk_rails_236fa407f6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_parts
    ADD CONSTRAINT fk_rails_236fa407f6 FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: stocks fk_rails_23c10d122b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_23c10d122b FOREIGN KEY (rmp_brand_id) REFERENCES public.rmp_brands(id);


--
-- Name: mark_cutting_quantities fk_rails_271139838d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cutting_quantities
    ADD CONSTRAINT fk_rails_271139838d FOREIGN KEY (mark_cutting_id) REFERENCES public.mark_cuttings(id);


--
-- Name: base_product_asset_infos fk_rails_29284a6ced; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_asset_infos
    ADD CONSTRAINT fk_rails_29284a6ced FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: assigned_brands fk_rails_2ce1dffc68; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assigned_brands
    ADD CONSTRAINT fk_rails_2ce1dffc68 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: stock_infos fk_rails_2d9a061aff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT fk_rails_2d9a061aff FOREIGN KEY (size_id) REFERENCES public.sizes(id);


--
-- Name: rmp_skus fk_rails_304611e11b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_skus
    ADD CONSTRAINT fk_rails_304611e11b FOREIGN KEY (rmp_size_id) REFERENCES public.rmp_sizes(id);


--
-- Name: rmp_classes fk_rails_30bd91e1a0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_classes
    ADD CONSTRAINT fk_rails_30bd91e1a0 FOREIGN KEY (rmp_color_id) REFERENCES public.rmp_colors(id);


--
-- Name: rmp_skus fk_rails_337d47f78f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_skus
    ADD CONSTRAINT fk_rails_337d47f78f FOREIGN KEY (rmp_class_id) REFERENCES public.rmp_classes(id);


--
-- Name: item_criteria fk_rails_351b1eca10; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria
    ADD CONSTRAINT fk_rails_351b1eca10 FOREIGN KEY (checked_by_id) REFERENCES public.users(id);


--
-- Name: base_product_asset_infos fk_rails_354eaa4947; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_asset_infos
    ADD CONSTRAINT fk_rails_354eaa4947 FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: quantities fk_rails_35d9f7c248; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantities
    ADD CONSTRAINT fk_rails_35d9f7c248 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: base_size_types fk_rails_370d2e4531; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_size_types
    ADD CONSTRAINT fk_rails_370d2e4531 FOREIGN KEY (size_type_id) REFERENCES public.size_types(id);


--
-- Name: stocks fk_rails_37e56a42b0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_37e56a42b0 FOREIGN KEY (size_id) REFERENCES public.sizes(id);


--
-- Name: assigned_brands fk_rails_38bf231178; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assigned_brands
    ADD CONSTRAINT fk_rails_38bf231178 FOREIGN KEY (authorized_brand_id) REFERENCES public.authorized_brands(id);


--
-- Name: notifications fk_rails_3926cc59dc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_rails_3926cc59dc FOREIGN KEY (job_sheet_dispatched_date_id) REFERENCES public.job_sheet_dispatched_dates(id);


--
-- Name: ratings fk_rails_3a059c0798; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT fk_rails_3a059c0798 FOREIGN KEY (to_id) REFERENCES public.users(id);


--
-- Name: stocks fk_rails_3a60232c0b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_3a60232c0b FOREIGN KEY (rmp_sku_id) REFERENCES public.rmp_skus(id);


--
-- Name: orders fk_rails_3dad120da9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_3dad120da9 FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- Name: job_sheet_mark_tailors fk_rails_3f55d5828a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_mark_tailors
    ADD CONSTRAINT fk_rails_3f55d5828a FOREIGN KEY (item_tailor_id) REFERENCES public.item_tailors(id);


--
-- Name: extra_quantities fk_rails_403cf55060; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extra_quantities
    ADD CONSTRAINT fk_rails_403cf55060 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: product_parts fk_rails_418e1d94fb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_parts
    ADD CONSTRAINT fk_rails_418e1d94fb FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: user_dealers fk_rails_4365cdb85e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dealers
    ADD CONSTRAINT fk_rails_4365cdb85e FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users fk_rails_45307c95a3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_45307c95a3 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: add_on_base_products fk_rails_4555bcafcd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_base_products
    ADD CONSTRAINT fk_rails_4555bcafcd FOREIGN KEY (add_on_id) REFERENCES public.add_ons(id);


--
-- Name: rmp_category_brands fk_rails_4589132e82; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_category_brands
    ADD CONSTRAINT fk_rails_4589132e82 FOREIGN KEY (rmp_brand_id) REFERENCES public.rmp_brands(id);


--
-- Name: product_parts fk_rails_4663704b7c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_parts
    ADD CONSTRAINT fk_rails_4663704b7c FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: back_order_links fk_rails_47af09fd3c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_order_links
    ADD CONSTRAINT fk_rails_47af09fd3c FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: rmp_min_infos fk_rails_47d34cd345; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_min_infos
    ADD CONSTRAINT fk_rails_47d34cd345 FOREIGN KEY (rmp_class_id) REFERENCES public.rmp_classes(id);


--
-- Name: colors fk_rails_47e8b016b1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colors
    ADD CONSTRAINT fk_rails_47e8b016b1 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: addresses fk_rails_48c9e0c5a2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT fk_rails_48c9e0c5a2 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: products fk_rails_4ca1aaca2b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_4ca1aaca2b FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: items fk_rails_53153f3b4b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_rails_53153f3b4b FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: milestones fk_rails_56886b3a4d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT fk_rails_56886b3a4d FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: stocks fk_rails_5827402eb4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_5827402eb4 FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: brandings fk_rails_590cf6ed01; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brandings
    ADD CONSTRAINT fk_rails_590cf6ed01 FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: job_sheet_assign_quantities fk_rails_5b9cc40c48; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities
    ADD CONSTRAINT fk_rails_5b9cc40c48 FOREIGN KEY (job_sheet_assign_date_id) REFERENCES public.job_sheet_assign_dates(id);


--
-- Name: mark_tailor_quantities fk_rails_5c501c6fde; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_tailor_quantities
    ADD CONSTRAINT fk_rails_5c501c6fde FOREIGN KEY (item_tailor_quantity_id) REFERENCES public.item_tailor_quantities(id);


--
-- Name: add_on_parts fk_rails_5cf148cac8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_parts
    ADD CONSTRAINT fk_rails_5cf148cac8 FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: products fk_rails_5f75608ee7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_5f75608ee7 FOREIGN KEY (fabric_id) REFERENCES public.fabrics(id);


--
-- Name: tasks fk_rails_60fd1557f7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_60fd1557f7 FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: item_tailor_quantities fk_rails_613e637822; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailor_quantities
    ADD CONSTRAINT fk_rails_613e637822 FOREIGN KEY (quantity_id) REFERENCES public.quantities(id);


--
-- Name: task_users fk_rails_62298b9246; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_users
    ADD CONSTRAINT fk_rails_62298b9246 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: rmp_min_infos fk_rails_6544027a2d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_min_infos
    ADD CONSTRAINT fk_rails_6544027a2d FOREIGN KEY (rmp_price_type_id) REFERENCES public.rmp_price_types(id);


--
-- Name: rmp_category_brands fk_rails_65d2e08e83; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_category_brands
    ADD CONSTRAINT fk_rails_65d2e08e83 FOREIGN KEY (rmp_category_id) REFERENCES public.rmp_categories(id);


--
-- Name: add_on_colors fk_rails_66bff83cce; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_colors
    ADD CONSTRAINT fk_rails_66bff83cce FOREIGN KEY (color_id) REFERENCES public.colors(id);


--
-- Name: add_on_base_products fk_rails_66eb5aad7d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_base_products
    ADD CONSTRAINT fk_rails_66eb5aad7d FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: base_product_fabrics fk_rails_69a6bd32d4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_fabrics
    ADD CONSTRAINT fk_rails_69a6bd32d4 FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: stock_infos fk_rails_6a469a9cde; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT fk_rails_6a469a9cde FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: quantities fk_rails_6bd9a4ff46; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantities
    ADD CONSTRAINT fk_rails_6bd9a4ff46 FOREIGN KEY (size_id) REFERENCES public.sizes(id);


--
-- Name: rmp_prices fk_rails_71bf46ad37; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_prices
    ADD CONSTRAINT fk_rails_71bf46ad37 FOREIGN KEY (rmp_price_type_id) REFERENCES public.rmp_price_types(id);


--
-- Name: job_sheet_assign_quantities fk_rails_72414cec8c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities
    ADD CONSTRAINT fk_rails_72414cec8c FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: notifications fk_rails_751fcdb777; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_rails_751fcdb777 FOREIGN KEY (recipient_id) REFERENCES public.users(id);


--
-- Name: base_product_parts fk_rails_7602cdbb20; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_parts
    ADD CONSTRAINT fk_rails_7602cdbb20 FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: orders fk_rails_774ef80392; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_774ef80392 FOREIGN KEY (address_id) REFERENCES public.addresses(id);


--
-- Name: stocks fk_rails_7a2f13cc74; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_7a2f13cc74 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: product_part_add_ons fk_rails_7b1c8828b7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_part_add_ons
    ADD CONSTRAINT fk_rails_7b1c8828b7 FOREIGN KEY (product_part_id) REFERENCES public.product_parts(id);


--
-- Name: item_criteria fk_rails_7e33c6982f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria
    ADD CONSTRAINT fk_rails_7e33c6982f FOREIGN KEY (unchecked_by_id) REFERENCES public.users(id);


--
-- Name: stock_infos fk_rails_7e6eee2cb5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT fk_rails_7e6eee2cb5 FOREIGN KEY (rmp_brand_id) REFERENCES public.rmp_brands(id);


--
-- Name: item_criteria fk_rails_7faded7d74; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria
    ADD CONSTRAINT fk_rails_7faded7d74 FOREIGN KEY (criteria_id) REFERENCES public.criteria(id);


--
-- Name: add_on_parts fk_rails_80c575be82; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_parts
    ADD CONSTRAINT fk_rails_80c575be82 FOREIGN KEY (add_on_id) REFERENCES public.add_ons(id);


--
-- Name: reset_password_histories fk_rails_814dddc544; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_password_histories
    ADD CONSTRAINT fk_rails_814dddc544 FOREIGN KEY (changed_by_id) REFERENCES public.users(id);


--
-- Name: job_sheet_assign_tailors fk_rails_8242172880; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_tailors
    ADD CONSTRAINT fk_rails_8242172880 FOREIGN KEY (job_sheet_assign_date_id) REFERENCES public.job_sheet_assign_dates(id);


--
-- Name: customer_requests fk_rails_82a09aa120; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_requests
    ADD CONSTRAINT fk_rails_82a09aa120 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: stock_infos fk_rails_82adb308d4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT fk_rails_82adb308d4 FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: extra_quantities fk_rails_82e94d7dc5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extra_quantities
    ADD CONSTRAINT fk_rails_82e94d7dc5 FOREIGN KEY (size_id) REFERENCES public.sizes(id);


--
-- Name: rmp_prices fk_rails_83fe2a1b52; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_prices
    ADD CONSTRAINT fk_rails_83fe2a1b52 FOREIGN KEY (rmp_sku_id) REFERENCES public.rmp_skus(id);


--
-- Name: reset_password_histories fk_rails_85379fe43e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_password_histories
    ADD CONSTRAINT fk_rails_85379fe43e FOREIGN KEY (changed_of_id) REFERENCES public.users(id);


--
-- Name: tasks fk_rails_8578e0e40d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_8578e0e40d FOREIGN KEY (updated_by_id) REFERENCES public.users(id);


--
-- Name: item_tailors fk_rails_8a0373af73; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailors
    ADD CONSTRAINT fk_rails_8a0373af73 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: fabric_colors fk_rails_8b393cb925; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_colors
    ADD CONSTRAINT fk_rails_8b393cb925 FOREIGN KEY (color_id) REFERENCES public.colors(id);


--
-- Name: item_criteria fk_rails_8c9b646075; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria
    ADD CONSTRAINT fk_rails_8c9b646075 FOREIGN KEY (updated_by_id) REFERENCES public.users(id);


--
-- Name: orders fk_rails_8eca224cec; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_8eca224cec FOREIGN KEY (customer_sc_id) REFERENCES public.users(id);


--
-- Name: products fk_rails_8f39f655a5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_8f39f655a5 FOREIGN KEY (fabric_color_id) REFERENCES public.colors(id);


--
-- Name: job_sheet_assign_quantities fk_rails_90f9105a9f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities
    ADD CONSTRAINT fk_rails_90f9105a9f FOREIGN KEY (item_tailor_id) REFERENCES public.item_tailors(id);


--
-- Name: users fk_rails_981d9855a6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_981d9855a6 FOREIGN KEY (rmp_price_type_id) REFERENCES public.rmp_price_types(id);


--
-- Name: orders fk_rails_98c1f26d70; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_98c1f26d70 FOREIGN KEY (back_order_for_id) REFERENCES public.orders(id);


--
-- Name: items fk_rails_9a56345cfd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_rails_9a56345cfd FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders fk_rails_9ac523da23; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_9ac523da23 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: users fk_rails_9e4eab2a89; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_9e4eab2a89 FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- Name: items fk_rails_9e6545b5af; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_rails_9e6545b5af FOREIGN KEY (rmp_brand_id) REFERENCES public.rmp_brands(id);


--
-- Name: catalogues fk_rails_a290f44b25; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogues
    ADD CONSTRAINT fk_rails_a290f44b25 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: tasks fk_rails_a362a150d3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_a362a150d3 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: part_colors fk_rails_a5c10826ca; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_colors
    ADD CONSTRAINT fk_rails_a5c10826ca FOREIGN KEY (color_id) REFERENCES public.colors(id);


--
-- Name: item_tailors fk_rails_a74d7d424c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailors
    ADD CONSTRAINT fk_rails_a74d7d424c FOREIGN KEY (tailor_id) REFERENCES public.users(id);


--
-- Name: base_product_asset_infos fk_rails_a829ed7cbe; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_asset_infos
    ADD CONSTRAINT fk_rails_a829ed7cbe FOREIGN KEY (add_on_id) REFERENCES public.add_ons(id);


--
-- Name: base_products fk_rails_a9c21907fc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_products
    ADD CONSTRAINT fk_rails_a9c21907fc FOREIGN KEY (asset_info_id) REFERENCES public.asset_infos(id);


--
-- Name: stock_useds fk_rails_abe08b873f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_useds
    ADD CONSTRAINT fk_rails_abe08b873f FOREIGN KEY (stock_id) REFERENCES public.stocks(id);


--
-- Name: job_sheet_tailor_mark_dates fk_rails_ac27ddd592; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_tailor_mark_dates
    ADD CONSTRAINT fk_rails_ac27ddd592 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: rmp_price_types fk_rails_adbd96b294; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_price_types
    ADD CONSTRAINT fk_rails_adbd96b294 FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- Name: products fk_rails_aefb4f3a33; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_aefb4f3a33 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: rmp_skus fk_rails_af7ad301ee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_skus
    ADD CONSTRAINT fk_rails_af7ad301ee FOREIGN KEY (rmp_brand_id) REFERENCES public.rmp_brands(id);


--
-- Name: items fk_rails_b014b81cc0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_rails_b014b81cc0 FOREIGN KEY (rmp_class_id) REFERENCES public.rmp_classes(id);


--
-- Name: notifications fk_rails_b39256a30c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_rails_b39256a30c FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: part_colors fk_rails_b57c7cd049; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_colors
    ADD CONSTRAINT fk_rails_b57c7cd049 FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: fabric_colors fk_rails_baec6817cb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_colors
    ADD CONSTRAINT fk_rails_baec6817cb FOREIGN KEY (fabric_id) REFERENCES public.fabrics(id);


--
-- Name: base_product_fabrics fk_rails_be02086472; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_fabrics
    ADD CONSTRAINT fk_rails_be02086472 FOREIGN KEY (fabric_id) REFERENCES public.fabrics(id);


--
-- Name: users fk_rails_c13c5ef817; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_c13c5ef817 FOREIGN KEY (parent_tailor_id) REFERENCES public.users(id);


--
-- Name: base_product_categories fk_rails_c24cf5e2e7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_categories
    ADD CONSTRAINT fk_rails_c24cf5e2e7 FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: mark_cuttings fk_rails_c2d2057a7a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cuttings
    ADD CONSTRAINT fk_rails_c2d2057a7a FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: orders fk_rails_c599ac4cad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_c599ac4cad FOREIGN KEY (assigned_to_id) REFERENCES public.users(id);


--
-- Name: rmp_skus fk_rails_c9ba83e458; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_skus
    ADD CONSTRAINT fk_rails_c9ba83e458 FOREIGN KEY (rmp_category_id) REFERENCES public.rmp_categories(id);


--
-- Name: sc_sizes fk_rails_cd1617da92; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sc_sizes
    ADD CONSTRAINT fk_rails_cd1617da92 FOREIGN KEY (size_type_id) REFERENCES public.size_types(id);


--
-- Name: users fk_rails_cf02ad0ea4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_cf02ad0ea4 FOREIGN KEY (factory_manager_id) REFERENCES public.users(id);


--
-- Name: stocks fk_rails_cfc800c26b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_cfc800c26b FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: rmp_sku_prices fk_rails_d0d2d32058; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rmp_sku_prices
    ADD CONSTRAINT fk_rails_d0d2d32058 FOREIGN KEY (rmp_price_id) REFERENCES public.rmp_prices(id);


--
-- Name: user_dealers fk_rails_dd5899a259; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dealers
    ADD CONSTRAINT fk_rails_dd5899a259 FOREIGN KEY (dealer_id) REFERENCES public.users(id);


--
-- Name: base_size_types fk_rails_ddb1abcb9e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_size_types
    ADD CONSTRAINT fk_rails_ddb1abcb9e FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: add_on_parts fk_rails_dfddf9e7e8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_parts
    ADD CONSTRAINT fk_rails_dfddf9e7e8 FOREIGN KEY (asset_info_id) REFERENCES public.asset_infos(id);


--
-- Name: item_criteria fk_rails_dfe64ab730; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_criteria
    ADD CONSTRAINT fk_rails_dfe64ab730 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: stock_useds fk_rails_e077ba64f5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_useds
    ADD CONSTRAINT fk_rails_e077ba64f5 FOREIGN KEY (dispatched_quantity_id) REFERENCES public.dispatched_quantities(id);


--
-- Name: back_order_links fk_rails_e3ccd9bfd2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_order_links
    ADD CONSTRAINT fk_rails_e3ccd9bfd2 FOREIGN KEY (back_order_id) REFERENCES public.orders(id);


--
-- Name: user_devices fk_rails_e700a96826; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT fk_rails_e700a96826 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: stock_infos fk_rails_e83a0244bb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_infos
    ADD CONSTRAINT fk_rails_e83a0244bb FOREIGN KEY (rmp_category_id) REFERENCES public.rmp_categories(id);


--
-- Name: job_sheet_mark_tailors fk_rails_e8d0fb9fa2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_mark_tailors
    ADD CONSTRAINT fk_rails_e8d0fb9fa2 FOREIGN KEY (job_sheet_tailor_mark_date_id) REFERENCES public.job_sheet_tailor_mark_dates(id);


--
-- Name: base_product_categories fk_rails_e9c1983dfa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.base_product_categories
    ADD CONSTRAINT fk_rails_e9c1983dfa FOREIGN KEY (base_product_id) REFERENCES public.base_products(id);


--
-- Name: mark_cutting_quantities fk_rails_ea20eb620b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_cutting_quantities
    ADD CONSTRAINT fk_rails_ea20eb620b FOREIGN KEY (quantity_id) REFERENCES public.quantities(id);


--
-- Name: add_on_colors fk_rails_ec7eeea224; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.add_on_colors
    ADD CONSTRAINT fk_rails_ec7eeea224 FOREIGN KEY (add_on_id) REFERENCES public.add_ons(id);


--
-- Name: job_sheet_assign_quantities fk_rails_edb6471817; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities
    ADD CONSTRAINT fk_rails_edb6471817 FOREIGN KEY (quantity_id) REFERENCES public.quantities(id);


--
-- Name: item_tailor_quantities fk_rails_ee9f3e55f4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tailor_quantities
    ADD CONSTRAINT fk_rails_ee9f3e55f4 FOREIGN KEY (item_tailor_id) REFERENCES public.item_tailors(id);


--
-- Name: mark_tailor_quantities fk_rails_f24a61c2eb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_tailor_quantities
    ADD CONSTRAINT fk_rails_f24a61c2eb FOREIGN KEY (job_sheet_mark_tailor_id) REFERENCES public.job_sheet_mark_tailors(id);


--
-- Name: orders fk_rails_f3f19ea594; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_rails_f3f19ea594 FOREIGN KEY (customer_dealer_id) REFERENCES public.users(id);


--
-- Name: stocks fk_rails_f4b3894c0d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT fk_rails_f4b3894c0d FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: job_sheet_assign_quantities fk_rails_f4fd3cd24f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_quantities
    ADD CONSTRAINT fk_rails_f4fd3cd24f FOREIGN KEY (job_sheet_assign_tailor_id) REFERENCES public.job_sheet_assign_tailors(id);


--
-- Name: cities fk_rails_f8d2792419; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT fk_rails_f8d2792419 FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- Name: products fk_rails_fb915499a4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_fb915499a4 FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: responsibilities fk_rails_feb8e13a9f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responsibilities
    ADD CONSTRAINT fk_rails_feb8e13a9f FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: job_sheet_assign_dates fk_rails_ff38aebd70; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_sheet_assign_dates
    ADD CONSTRAINT fk_rails_ff38aebd70 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- PostgreSQL database dump complete
--

\unrestrict I4KowjYlRu55SDPgZQA7a7SZIqKRJo6sXsubNmn9LXVs5Ccsi9co01wLjuPzhWk

