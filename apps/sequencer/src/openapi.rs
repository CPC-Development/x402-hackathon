use utoipa::OpenApi;

use crate::{handlers, model};

#[derive(OpenApi)]
#[openapi(
    paths(
        handlers::health,
        handlers::list_channels_by_owner,
        handlers::seed_channel,
        handlers::get_channel,
        handlers::finalize_channel,
        handlers::validate_pay_in_channel,
        handlers::settle
    ),
    components(
        schemas(
            model::SeedChannelRequest,
            model::PayInChannelRequest,
            model::FinalizeChannelRequest,
            model::FeeForPayment,
            model::ChannelView,
            model::ChannelsByOwnerResponse,
            model::RecipientView,
            model::PayInChannelResponse,
            model::FinalizeChannelResponse
        )
    ),
    tags(
        (name = "sequencer", description = "CPC sequencer endpoints")
    ),
    info(
        title = "CPC Sequencer API",
        description = "Sequencer endpoints for CPC payment-channel updates. Use /docs for Swagger UI.",
        version = "0.1.0"
    )
)]
pub struct ApiDoc;
